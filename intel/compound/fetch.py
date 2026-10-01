#!/usr/bin/env python3
"""Compounding test: a token's top holders (straight from the chain) and every transaction on their token account and
reward-token account since START.

usage: fetch.py MINT REWARD_MINT START OUT.json      (env TOP = how many holders, default 100)
Helius getTransactionsForAddress (10 credits per 100 transactions) when available, else getSignaturesForAddress +
getTransaction. Prints calls and estimated credits. Never prints the RPC URL.
"""
import base64, json, os, struct, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pda import b58d, b58e, on_curve, pda, ATA

KEY = os.environ.get('HELIUS_KEY', '').strip(); URL = os.environ.get('SOLANA_RPC', '').strip()
RPC = URL or (f'https://mainnet.helius-rpc.com/?api-key={KEY}' if KEY else 'https://api.mainnet-beta.solana.com')
MINT, QUOTE, START, OUT = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
TOP = int(os.environ.get('TOP', 100))
PAYOUT = 'HuBMeYW3aDn8BH65fo8xxbP4oiexyup8udzKyccgi8Ga'
SOL = 'So11111111111111111111111111111111111111112'
# pool / program authorities that hold tokens but aren't people (also: any owner that's a program address, below)
NOT_WALLETS = {'5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1', 'GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL',
               'WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh', 'HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC'}
CALLS, CREDITS = {}, [0]
TXOPT = {'encoding': 'jsonParsed', 'maxSupportedTransactionVersion': 1}


def rpc(m, p, tries=6):
    CALLS[m] = CALLS.get(m, 0) + 1
    for i in range(tries):
        try:
            r = urllib.request.Request(RPC, json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': m, 'params': p}).encode(),
                                       {'Content-Type': 'application/json', 'User-Agent': 'war-room-compound'})
            d = json.load(urllib.request.urlopen(r, timeout=120))
        except Exception as e:
            if i == tries - 1: raise RuntimeError(f'{m}: {type(e).__name__}')
            time.sleep(2 * (i + 1)); continue
        if 'error' in d:
            if d['error'].get('code') == 429 and i < tries - 1: time.sleep(2 * (i + 1)); continue
            raise RuntimeError(f"{m}: {d['error'].get('message')}")
        return d['result']


def program_of(mint): return rpc('getAccountInfo', [mint, {'encoding': 'base64', 'dataSlice': {'offset': 0, 'length': 0}}])['value']['owner']


# ---------- top holders: every token account of the mint (owner + amount), summed per owner ----------
prog = program_of(MINT); qprog = program_of(QUOTE)
dec = rpc('getTokenSupply', [MINT])['value']['decimals']; supply = float(rpc('getTokenSupply', [MINT])['value']['uiAmount'])
accs = rpc('getProgramAccounts', [prog, {'encoding': 'base64', 'dataSlice': {'offset': 32, 'length': 40},
                                         'filters': [{'memcmp': {'offset': 0, 'bytes': MINT}}]}]); CREDITS[0] += 10
own = {}
for a in accs:
    raw = base64.b64decode(a['account']['data'][0])
    if len(raw) < 40: continue
    o = b58e(raw[:32]); own[o] = own.get(o, 0) + struct.unpack('<Q', raw[32:40])[0] / 10 ** dec
ranked = sorted(own.items(), key=lambda kv: -kv[1])
people = [(w, b) for w, b in ranked if b > 0 and w not in NOT_WALLETS and on_curve(b58d(w))]   # program-owned = pools, lockers
skipped = [(w, round(b / supply * 100, 2)) for w, b in ranked[:TOP] if (w, b) not in people[:TOP] and b > 0][:10]
holders = people[:TOP]
print(f'{len([1 for v in own.values() if v > 0])} holders · top {TOP} hold {sum(b for _, b in holders) / supply * 100:.1f}% of supply · '
      f'skipped (pools/programs) {skipped}', flush=True)

GTFA = [bool(KEY or 'helius' in URL)]


def history(addr):
    if GTFA[0]:
        try:
            out, tok = [], None
            while True:
                opts = {'transactionDetails': 'full', **TXOPT, 'sortOrder': 'desc', 'limit': 100, 'filters': {'blockTime': {'gte': START}}}
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
        try: return rpc('getTransaction', [s['signature'], TXOPT])
        except Exception: return None
    CREDITS[0] += len(sigs)
    return [t for t in ThreadPoolExecutor(8).map(get, sigs) if t]


def ata(owner, mint, program): return pda([b58d(owner), b58d(program), b58d(mint)], ATA)


def one(item):
    w, bal = item
    seen, txs = set(), []
    for addr in (ata(w, MINT, prog), ata(w, QUOTE, qprog)):   # derived, so closed accounts' history counts too
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
    return w, {'bal': bal, 'pct': bal / supply * 100, 'tx': sorted(txs, key=lambda x: x['t'])}


db = {}
with ThreadPoolExecutor(4) as ex:
    for n, (w, d) in enumerate(ex.map(one, holders), 1):
        db[w] = d
        if n % 10 == 0: print(f'{n}/{len(holders)} holders · credits so far {CREDITS[0]}', flush=True)
json.dump({'mint': MINT, 'quote': QUOTE, 'start': START, 'supply': supply, 'holders': db}, open(OUT, 'w'))
print('calls', CALLS, '· estimated Helius credits', CREDITS[0], flush=True)
