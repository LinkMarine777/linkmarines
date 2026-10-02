#!/usr/bin/env python3
"""Accuracy audit for the compound score (one-off, read-only): rebuilds a token's tracked wallets straight from the chain so it
can be compared with what compound-state.json holds. Writes audit/<mint>.json; the comparison is done offline.

Per wallet (the ones the 6-hourly job tracks): every transaction on its real token accounts and its real reward-token
accounts since the job started tracking the token, through its last update:
  swaps (token in / out against anything else), transfers (token only, with who was on the other side), other moves,
  and reward-token payouts (in, not signed by the wallet, nothing else moved) with the whole batch's recipients, so the
  token's own payout rounds can be told apart from other tokens' paid from the same stonkfun wallet.
Plus the token's current holders and hourly prices (GeckoTerminal) for the token, the reward token and SOL.
Usage: audit.py <data dir> [mint ...]   (default $MARINE). ~50 Helius credits a wallet. Never prints the RPC URL."""
import base64, json, os, struct, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pda import b58d, b58e, pda, ATA

DATA = sys.argv[1]; MINTS = sys.argv[2:] or ['F8Sc8HoZvJcMrTY6vBsetTqGPv6XQmM2XgVAZo1sSTNK']
KEY = os.environ.get('HELIUS_KEY', '').strip(); URL = os.environ.get('SOLANA_RPC', '').strip()
RPC = f'https://mainnet.helius-rpc.com/?api-key={KEY}' if KEY else URL   # Helius: getTransactionsForAddress (100 transactions a call)
SOL = 'So11111111111111111111111111111111111111112'
T22 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
CREDITS = [0]


def get(url, tries=5):
    for i in range(tries):
        try: return json.load(urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'war-room-audit'}), timeout=30))
        except Exception as e:
            if i == tries - 1: raise
            time.sleep(15 * (i + 1) if '429' in str(e) else 3)


def rpc(m, p, tries=8):
    for i in range(tries):
        try:
            d = json.load(urllib.request.urlopen(urllib.request.Request(RPC, json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': m, 'params': p}).encode(),
                                                 {'Content-Type': 'application/json', 'User-Agent': 'war-room-audit'}), timeout=120))
        except Exception as e:
            if i == tries - 1: raise RuntimeError(f"{m}: {type(e).__name__} {getattr(e, 'code', '') or ''}")
            time.sleep(3 * (i + 1)); continue
        if 'error' in d:
            if d['error'].get('code') in (429, -32429) and i < tries - 1: time.sleep(3 * (i + 1)); continue
            raise RuntimeError(f"{m}: {d['error'].get('message')}")
        return d['result']


def history(addr, since, until):
    """The account's transactions in [since, until], cheapest way: list signatures (1 credit), then up to 10 one by one
    (1 credit each), more with the batch call (10 credits per 100)."""
    sigs, before = [], None
    while True:
        r = rpc('getSignaturesForAddress', [addr, {'limit': 1000, **({'before': before} if before else {})}]); CREDITS[0] += 1
        sigs += [x['signature'] for x in r if since <= (x.get('blockTime') or 0) <= until and not x.get('err')]
        if len(r) < 1000 or (r[-1].get('blockTime') or 0) < since: break
        before = r[-1]['signature']
    if len(sigs) <= 10:
        CREDITS[0] += len(sigs)
        return [t for t in (rpc('getTransaction', [x, {'encoding': 'jsonParsed', 'maxSupportedTransactionVersion': 1}]) for x in sigs) if t]
    out, tok = [], None
    while True:
        opts = {'transactionDetails': 'full', 'encoding': 'jsonParsed', 'maxSupportedTransactionVersion': 1, 'sortOrder': 'desc',
                'limit': 100, 'filters': {'blockTime': {'gte': since, 'lte': until}}}
        if tok: opts['paginationToken'] = tok
        r = rpc('getTransactionsForAddress', [addr, opts]); rows = r.get('data') or []; out += rows
        CREDITS[0] += max(10, -(-len(rows) // 100) * 10); tok = r.get('paginationToken')
        if not tok or not rows: return out


def accounts(w, mint):
    """The wallet's open token accounts for `mint` plus its standard one even if closed (a closed account keeps its history)."""
    if mint not in PROG: PROG[mint] = rpc('getAccountInfo', [mint, {'encoding': 'base64', 'dataSlice': {'offset': 0, 'length': 0}}])['value']['owner']
    r = rpc('getTokenAccountsByOwner', [w, {'mint': mint}, {'encoding': 'base64', 'dataSlice': {'offset': 0, 'length': 0}}]); CREDITS[0] += 1
    return list(dict.fromkeys([a['pubkey'] for a in r['value']] + [pda([b58d(w), b58d(PROG[mint]), b58d(mint)], ATA)]))


def holders(mint, prog, dec):
    own = {}
    try:
        for a in rpc('getProgramAccounts', [prog, {'encoding': 'base64', 'dataSlice': {'offset': 32, 'length': 40}, 'filters': [{'memcmp': {'offset': 0, 'bytes': mint}}]}]):
            raw = base64.b64decode(a['account']['data'][0]); o = b58e(raw[:32]); own[o] = own.get(o, 0) + struct.unpack('<Q', raw[32:40])[0] / 10 ** dec
        CREDITS[0] += 10
    except RuntimeError:
        cur = None
        while True:
            r = rpc('getTokenAccounts', {'mint': mint, 'limit': 1000, **({'cursor': cur} if cur else {})}); CREDITS[0] += 10
            for a in r.get('token_accounts') or []: own[a['owner']] = own.get(a['owner'], 0) + float(a.get('amount') or 0) / 10 ** dec
            cur = r.get('cursor')
            if not cur or len(r.get('token_accounts') or []) < 1000: break
    return {o: b for o, b in own.items() if b > 0}


def prices(mint, since):
    """Hourly closes from the token's busiest pool on GeckoTerminal, back to `since`."""
    try:
        time.sleep(2.5); p = get(f'https://api.geckoterminal.com/api/v2/networks/solana/tokens/{mint}/pools?page=1')
        pool = p['data'][0]; side = 'base' if pool['relationships']['base_token']['data']['id'].endswith(mint) else 'quote'
        out, before = [], int(time.time())
        for _ in range(6):
            if before <= since: break
            time.sleep(3)
            r = get(f"https://api.geckoterminal.com/api/v2/networks/solana/pools/{pool['attributes']['address']}/ohlcv/hour?aggregate=1&limit=1000&before_timestamp={before}&token={side}")
            rows = r['data']['attributes']['ohlcv_list']
            if not rows or min(int(x[0]) for x in rows) >= before: break
            out += [(int(x[0]), float(x[4])) for x in rows]; before = min(int(x[0]) for x in rows)
        return sorted(set(out))
    except Exception as e: print('  no price history for', mint[:6], e); return []


def deltas(tx, w):
    m = tx['meta']; keys = [k['pubkey'] for k in tx['transaction']['message']['accountKeys']]; ch = {}
    for side, sgn in (('preTokenBalances', -1), ('postTokenBalances', 1)):
        for b in m.get(side) or []:
            if b.get('owner') == w: ch[b['mint']] = ch.get(b['mint'], 0) + sgn * float((b.get('uiTokenAmount') or {}).get('uiAmountString') or 0)
    if w in keys:
        i = keys.index(w); ch[SOL] = ch.get(SOL, 0) + (m['postBalances'][i] - m['preBalances'][i] + (m.get('fee', 0) if i == 0 else 0)) / 1e9
    return {k: v for k, v in ch.items() if abs(v) > 1e-9}, keys[0] == w, keys[0]


def moved(tx, mint):
    """{owner: change} of `mint` across everyone in the transaction."""
    m = tx['meta']; pre = {b['accountIndex']: float((b.get('uiTokenAmount') or {}).get('uiAmountString') or 0) for b in m.get('preTokenBalances') or [] if b['mint'] == mint}
    own = {b['accountIndex']: b.get('owner') for b in (m.get('preTokenBalances') or []) + (m.get('postTokenBalances') or []) if b['mint'] == mint}
    post = {b['accountIndex']: float((b.get('uiTokenAmount') or {}).get('uiAmountString') or 0) for b in m.get('postTokenBalances') or [] if b['mint'] == mint}
    out = {}
    for i in set(pre) | set(post):
        d = post.get(i, 0) - pre.get(i, 0)
        if abs(d) > 1e-12: out[own[i]] = out.get(own[i], 0) + d
    return out


def audit(mint):
    state = json.load(open(os.path.join(DATA, 'compound-state.json')))['tokens'][mint]
    rw = {x['mint']: x for x in get('https://www.stonkfun.xyz/api/public/v1/rewards')['data']['launches']}[mint]
    quote = rw['quote']['mint']; since, until = state['since'], state['at']; W = list(state['bal'])
    print(f"${state.get('sym')}: {len(W)} wallets, reward token {rw['quote'].get('symbol')}, {time.strftime('%Y-%m-%d', time.gmtime(since))} .. {time.strftime('%Y-%m-%d %H:%M', time.gmtime(until))}")
    batches = {}

    def one(w):
        seen, ev = set(), []
        for a in accounts(w, mint) + accounts(w, quote):
            for tx in history(a, since, until):
                sig = tx['transaction']['signatures'][0]
                if sig in seen or (tx.get('meta') or {}).get('err'): continue
                seen.add(sig); t = tx.get('blockTime') or until
                ch, signed, payer = deltas(tx, w); dx, q = ch.get(mint, 0), ch.get(quote, 0)
                if q > 0 and not signed and all(abs(v) < 1e-6 for k, v in ch.items() if k != quote):
                    if sig not in batches: batches[sig] = [t, [[o, round(d, 12)] for o, d in moved(tx, quote).items() if d > 0]]
                    ev.append([t, sig, 'payout', q]); continue
                if not dx: continue
                other = {k: v for k, v in ch.items() if k != mint and not (k == SOL and abs(v) < 0.01)}
                if not other:
                    cp = [[o, round(d, 6)] for o, d in moved(tx, mint).items() if o != w and d * dx < 0]
                    ev.append([t, sig, 'transfer', dx, signed, payer, cp]); continue
                ev.append([t, sig, 'swap', dx, signed, payer, {k: round(v, 9) for k, v in other.items()}])
        return w, sorted(ev)

    with ThreadPoolExecutor(4) as ex: wallets = dict(ex.map(one, W))
    T = state.get('prog') or T22
    out = {'mint': mint, 'quote': quote, 'since': since, 'until': until, 'bal': state['bal'], 'days': {w: state['days'].get(w) for w in W},
           'holders': holders(mint, T, state.get('dec', 6)), 'px': {m: prices(m, since - 86400) for m in (mint, quote, SOL)},
           'wallets': wallets, 'batches': batches}
    os.makedirs('audit', exist_ok=True); json.dump(out, open(f'audit/{mint}.json', 'w'), separators=(',', ':'))
    print(f"  {sum(len(v) for v in wallets.values())} wallet transactions, {len(batches)} payout batches · credits so far {CREDITS[0]}")


for m in MINTS: audit(m)
print('estimated Helius credits', CREDITS[0])
