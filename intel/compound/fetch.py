#!/usr/bin/env python3
"""Compounding test: for a token's top holders, read only their token account and reward-token account since START.

usage: fetch.py MINT REWARD_MINT START OUT.json STATE.json
Uses Helius getTransactionsForAddress (10 credits per 100 transactions) when the RPC supports it, otherwise
getSignaturesForAddress + getTransaction (1 credit each). Prints the calls and credits used. Never prints the RPC URL.
"""
import json, os, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pda import atas

KEY = os.environ.get('HELIUS_KEY', '').strip(); URL = os.environ.get('SOLANA_RPC', '').strip()
RPC = URL or (f'https://mainnet.helius-rpc.com/?api-key={KEY}' if KEY else 'https://api.mainnet-beta.solana.com')
MINT, QUOTE, START, OUT, STATE = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4], sys.argv[5]
TOP = int(os.environ.get('TOP', 20))
PAYOUT = 'HuBMeYW3aDn8BH65fo8xxbP4oiexyup8udzKyccgi8Ga'
SOL = 'So11111111111111111111111111111111111111112'
SKIP = {'5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1', 'GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL',
        'WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh', 'HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC',
        'BnkYfw796XXq9UQ9kMYoX9iqSgXnjw7sFCsCVWVDiCUa', '7TM5qRz9SRq5FNbE75nUpxeXKeN14MsPPbpDo6Wrw225',
        'BTccxxTFi7a9xJTE1exKn38Jgie35s6gNeRxd8DM61Rc'}
CALLS, CREDITS = {}, [0]


def rpc(m, p, tries=6):
    CALLS[m] = CALLS.get(m, 0) + 1
    for i in range(tries):
        try:
            r = urllib.request.Request(RPC, json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': m, 'params': p}).encode(),
                                       {'Content-Type': 'application/json', 'User-Agent': 'war-room-compound'})
            d = json.load(urllib.request.urlopen(r, timeout=60))
        except Exception as e:
            if i == tries - 1: raise RuntimeError(f'{m}: {type(e).__name__}')
            time.sleep(2 * (i + 1)); continue
        if 'error' in d:
            if d['error'].get('code') == 429 and i < tries - 1: time.sleep(2 * (i + 1)); continue
            raise RuntimeError(f"{m}: {d['error'].get('message')}")
        return d['result']


GTFA = [bool(KEY or 'helius' in URL)]   # Helius only; switched off on the first refusal


def history(addr):
    """Every successful transaction touching addr since START (full, jsonParsed)."""
    if GTFA[0]:
        try:
            out, tok = [], None
            while True:
                opts = {'transactionDetails': 'full', 'encoding': 'jsonParsed', 'maxSupportedTransactionVersion': 0,
                        'sortOrder': 'desc', 'limit': 100, 'filters': {'blockTime': {'gte': START}}}
                if tok: opts['paginationToken'] = tok
                r = rpc('getTransactionsForAddress', [addr, opts], tries=3)
                rows = r.get('data') or []
                out += rows; CREDITS[0] += max(10, -(-len(rows) // 100) * 10)
                tok = r.get('paginationToken')
                if not tok or not rows: return out
        except RuntimeError as e:
            print('getTransactionsForAddress not available, falling back:', e, flush=True); GTFA[0] = False
    sigs, before = [], None
    while True:
        r = rpc('getSignaturesForAddress', [addr, {'limit': 1000, **({'before': before} if before else {})}]); CREDITS[0] += 1
        keep = [s for s in r if (s.get('blockTime') or 0) >= START and not s.get('err')]
        sigs += keep
        if len(r) < 1000 or len(keep) < len(r): break
        before = r[-1]['signature']

    def get(s):
        try: return rpc('getTransaction', [s['signature'], {'encoding': 'jsonParsed', 'maxSupportedTransactionVersion': 0}])
        except Exception: return None
    CREDITS[0] += len(sigs)
    return [t for t in ThreadPoolExecutor(8).map(get, sigs) if t]


holders = [(w, b) for w, b in json.load(open(STATE))['holders'][MINT]['w'] if w not in SKIP][:TOP]
db = {}
for w, bal in holders:
    seen, txs = set(), []
    for addr in atas(w, MINT) + atas(w, QUOTE):   # derived addresses, so closed accounts' history counts too
        for tx in history(addr):
            sig = tx['transaction']['signatures'][0]
            if sig in seen or (tx.get('meta') or {}).get('err'): continue
            seen.add(sig)
            m = tx['meta']; keys = [k['pubkey'] for k in tx['transaction']['message']['accountKeys']]
            ch = {}
            for side, sgn in (('preTokenBalances', -1), ('postTokenBalances', 1)):
                for b in m.get(side) or []:
                    if b.get('owner') == w:
                        ch[b['mint']] = ch.get(b['mint'], 0) + sgn * float((b.get('uiTokenAmount') or {}).get('uiAmountString') or 0)
            if w in keys:
                i = keys.index(w); ch[SOL] = ch.get(SOL, 0) + (m['postBalances'][i] - m['preBalances'][i] + (m.get('fee', 0) if i == 0 else 0)) / 1e9
            ch = {k: v for k, v in ch.items() if abs(v) > 1e-9}
            if ch: txs.append({'sig': sig, 't': tx.get('blockTime'), 'ch': ch, 'payout': PAYOUT in keys, 'signer': keys[0] == w})
    db[w] = {'bal': bal, 'tx': txs}
    print(w[:8], round(bal), len(txs), 'txs', '· credits so far', CREDITS[0], flush=True)
json.dump(db, open(OUT, 'w'))
print('calls', CALLS, '· estimated Helius credits', CREDITS[0], flush=True)
