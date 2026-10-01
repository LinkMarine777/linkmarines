#!/usr/bin/env python3
"""Compounding: are the holders of stonkfun's reward tokens putting their rewards back into the token?

Runs every 6 h on GitHub Actions (.github/workflows/compound.yml) for every reward token the site lists ($MARINE,
stonkfun's top 30 and the Stonk Board's top 100, ~100 tokens) and writes into the data branch:
  terminal/compound/<mint>.json   what the token page reads: the token's compound score, tags, and one row per wallet
  terminal/compound/index.json    every tracked token's summary (scores for 7d / 30d / all)
  terminal/compound-state.json    memory between runs: last balances, payout total and daily numbers per wallet

Wallets: the fewest that together own 80% of the token's supply held by people (pools / program accounts excluded),
at least 20 and at most 600 ($MARINE ~85, $ZCAT ~460).

Every run: stonkfun's payout totals for all tokens (one call) and prices (Jupiter, 50 tokens a call); per token a few
Helius credits (getProgramAccountsV2, 1 credit per 10,000 accounts; ~15-30K credits a month for ~100 tokens):
  - every holder's balance (one getProgramAccounts) and stonkfun's payout total for the token (distributedTokens)
  - rewards since the last run: the payout total's growth x the wallet's share of the eligible supply (wallets worth at
    least stonkfun's minimum holding). Checked against each payout read one by one for $MARINE's top 20: within ~2%.
  - buying / selling: the change in the wallet's balance (moving tokens between your own wallets looks like a trade)
  added to the wallet's numbers for that day (UTC), kept 90 days.
--backfill ($MARINE + stonkfun's top 10 by market cap only): the last 7 days read exactly instead (each wallet's token account + reward-token account; payouts counted
only when they match one of the token's own payout rounds, since stonkfun pays every LINK / ZEC / ... token from shared
wallets) for each token's 200 biggest wallets, then the 6-hourly runs carry on from there (the rest start then).
One-off: ~45K credits for all 11 tokens (two reads per wallet, 10+ credits each).

Score per wallet over a window, counting from its first reward (the buy that got it in isn't compounding):
  R = rewards ($), N = net bought ($), c = min(max(N, 0), R) / R, k = share of reward days with a buy that day or the next
  score = 100 x (0.7 c + 0.3 k), 0 for a net seller · Compounder c >= 50% · Partial 10-50% · Collector < 10% · Seller N < 0
Token score: the wallets' scores weighted by how much they hold.
Never prints the RPC URL.
"""
import base64, bisect, json, os, struct, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
from statistics import median
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pda import b58d, b58e, on_curve, pda, ATA

OUT = sys.argv[1] if len(sys.argv) > 1 else 'terminal'
BACKFILL = '--backfill' in sys.argv
KEY = os.environ.get('HELIUS_KEY', '').strip(); URL = os.environ.get('SOLANA_RPC', '').strip()
RPC = URL or (f'https://mainnet.helius-rpc.com/?api-key={KEY}' if KEY else 'https://api.mainnet-beta.solana.com')
SF = 'https://www.stonkfun.xyz'
MARINE = 'F8Sc8HoZvJcMrTY6vBsetTqGPv6XQmM2XgVAZo1sSTNK'
SOL = 'So11111111111111111111111111111111111111112'
STABLE = {'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'}
NOT_WALLETS = {'5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1', 'GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL',
               'WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh', 'HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC'}
DAY, KEEP_DAYS, COVER, MIN_W, MAX_W = 86400, 90, 0.8, 20, 600
BACKFILL_W, BACKFILL_DAYS = int(os.environ.get('BACKFILL_W', 200)), int(os.environ.get('BACKFILL_DAYS', 7))
now = int(time.time()); today = now // DAY
CALLS, CREDITS = {}, [0]


def log(*a):
    out = ' '.join(str(x) for x in a)
    for k in (KEY, URL):
        if k: out = out.replace(k, '***')
    print(out, flush=True)


def get(url, tries=4):
    for i in range(tries):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'war-room-compound'}), timeout=30))
        except Exception as e:
            if i == tries - 1: raise
            time.sleep(5 * (i + 1) if '429' in str(e) else 2)


def rpc(m, p, tries=6):
    CALLS[m] = CALLS.get(m, 0) + 1
    for i in range(tries):
        try:
            r = urllib.request.Request(RPC, json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': m, 'params': p}).encode(),
                                       {'Content-Type': 'application/json', 'User-Agent': 'war-room-compound'})
            d = json.load(urllib.request.urlopen(r, timeout=120))
        except Exception as e:
            code = getattr(e, 'code', None)
            if i == tries - 1: raise RuntimeError(f"{m}: {type(e).__name__} {code or ''}".strip())
            time.sleep(5 * (i + 1) if code == 429 else 2 * (i + 1)); continue
        if 'error' in d:
            if d['error'].get('code') == 429 and i < tries - 1: time.sleep(5 * (i + 1)); continue
            raise RuntimeError(f"{m}: {d['error'].get('message')}")
        return d['result']


def load(name, default):
    try: return json.load(open(os.path.join(OUT, name)))
    except Exception: return default


def save(name, data):
    path = os.path.join(OUT, name); os.makedirs(os.path.dirname(path), exist_ok=True)
    json.dump(data, open(path + '.tmp', 'w'), separators=(',', ':')); os.replace(path + '.tmp', path)


# ---------- which tokens: every reward token the site lists ----------
toks = load('tokens.json', {}).get('tokens', []); board = load('board.json', {}).get('tokens', {})
names = {**{m: b.get('symbol') for m, b in board.items()}, **{t['mint']: t.get('symbol') for t in toks}}
mcap = {**{m: b.get('mcap') or 0 for m, b in board.items()}, **{t['mint']: t.get('mcap') or 0 for t in toks}}
ranked = [m for m in sorted(set(mcap) - {MARINE}, key=lambda m: -(mcap[m] or 0))]
G = {x['mint']: x for x in get(f'{SF}/api/public/v1/rewards')['data']['launches']}   # every launch's payout total, one call
watch = [m for m in [MARINE] + ranked if m in G]
backfill_set = set(watch[:11])                                                        # $MARINE + the top 10 by market cap
price = {}
mints = sorted(set(watch) | {SOL} | {G[m]['quote']['mint'] for m in watch if (G[m].get('quote') or {}).get('mint')})
for i in range(0, len(mints), 50):
    try:
        for t in get('https://lite-api.jup.ag/tokens/v2/search?query=' + ','.join(mints[i:i + 50])):
            price[t['id']] = float(t.get('usdPrice') or 0); names.setdefault(t['id'], t.get('symbol'))
    except Exception as e: log('jupiter', e)
    time.sleep(1)
state = load('compound-state.json', {'tokens': {}})
ST = state['tokens']


def holders(mint, T):
    """Every wallet's balance (people only: pool authorities and program-owned accounts are skipped)."""
    if 'prog' not in T:
        T['prog'] = rpc('getAccountInfo', [mint, {'encoding': 'base64', 'dataSlice': {'offset': 0, 'length': 0}}])['value']['owner']
        T['dec'] = rpc('getTokenSupply', [mint])['value']['decimals']
    opts = {'encoding': 'base64', 'dataSlice': {'offset': 32, 'length': 40}, 'filters': [{'memcmp': {'offset': 0, 'bytes': mint}}]}
    accs = None
    if KEY or 'helius' in URL:   # Helius: the paginated version (1 credit a page of 10,000; the plain one refuses big programs)
        try:
            accs, key = [], None
            for _ in range(100):
                r = rpc('getProgramAccountsV2', [T['prog'], {**opts, 'limit': 10000, **({'paginationKey': key} if key else {})}]); CREDITS[0] += 1
                accs += r.get('accounts') or []; key = r.get('paginationKey')
                if not key or not r.get('accounts'): break
        except RuntimeError as e: log('  getProgramAccountsV2 refused, trying the plain call:', e); accs = None
    if accs is None: accs = rpc('getProgramAccounts', [T['prog'], opts]); CREDITS[0] += 10
    own = {}
    for a in accs:
        raw = base64.b64decode(a['account']['data'][0])
        if len(raw) < 40: continue
        o = b58e(raw[:32]); own[o] = own.get(o, 0) + struct.unpack('<Q', raw[32:40])[0] / 10 ** T['dec']
    return {o: b for o, b in own.items() if b > 0 and o not in NOT_WALLETS and on_curve(b58d(o))}


def top_set(people):
    ranked = sorted(people.items(), key=lambda kv: -kv[1]); tot = sum(people.values()) or 1; cum, out = 0, []
    for w, b in ranked:
        if len(out) >= MAX_W or (cum >= COVER * tot and len(out) >= MIN_W): break
        out.append(w); cum += b
    return out


def add(T, w, day, R=0.0, B=0.0, S=0.0):
    d = T.setdefault('days', {}).setdefault(w, {}).setdefault(str(day), [0, 0, 0])
    d[0] = round(d[0] + R, 4); d[1] = round(d[1] + B, 4); d[2] = round(d[2] + S, 4)


# ---------- the exact 7-day read (backfill) ----------
def series(mint, since, now_px):
    """$ price per hour from GeckoTerminal (the token's busiest pool); today's price if GeckoTerminal won't answer."""
    try: return series_gt(mint, since)
    except Exception as e: log('  price history unavailable, using the current price:', mint[:6], e); return [(since, now_px)] if now_px else []


def series_gt(mint, since):
    time.sleep(2.2)
    p = get(f'https://api.geckoterminal.com/api/v2/networks/solana/tokens/{mint}/pools?page=1')
    if not p or not p.get('data'): return []
    pool = p['data'][0]; side = 'base' if pool['relationships']['base_token']['data']['id'].endswith(mint) else 'quote'
    time.sleep(2.2)
    r = get(f"https://api.geckoterminal.com/api/v2/networks/solana/pools/{pool['attributes']['address']}/ohlcv/hour?aggregate=1&limit=1000&token={side}")
    return sorted((int(x[0]), float(x[4])) for x in r['data']['attributes']['ohlcv_list'] if int(x[0]) >= since - 7200)


GTFA = [bool(KEY or 'helius' in URL)]   # Helius' batch history; else (or if it's refused) one transaction at a time


FAILS = [0]


def history(addr, since):
    if not GTFA[0]: return history_slow(addr, since)
    try: return history_fast(addr, since)
    except RuntimeError as e:   # this address only (the free plan rate-limits bursts); 10 refusals in a run = stop using it
        FAILS[0] += 1; log('getTransactionsForAddress refused, reading this one one by one:', e)
        if FAILS[0] >= 10: GTFA[0] = False
        return history_slow(addr, since)


def history_slow(addr, since):
    sigs, before = [], None
    while True:
        r = rpc('getSignaturesForAddress', [addr, {'limit': 1000, **({'before': before} if before else {})}]); CREDITS[0] += 1
        keep = [x for x in r if (x.get('blockTime') or 0) >= since and not x.get('err')]; sigs += keep
        if len(r) < 1000 or len(keep) < len(r): break
        before = r[-1]['signature']
    CREDITS[0] += len(sigs)
    return [t for t in (rpc('getTransaction', [x['signature'], {'encoding': 'jsonParsed', 'maxSupportedTransactionVersion': 1}]) for x in sigs) if t]


def history_fast(addr, since):
    out, tok = [], None
    while True:
        opts = {'transactionDetails': 'full', 'encoding': 'jsonParsed', 'maxSupportedTransactionVersion': 1, 'sortOrder': 'desc',
                'limit': 100, 'filters': {'blockTime': {'gte': since}}}
        if tok: opts['paginationToken'] = tok
        r = rpc('getTransactionsForAddress', [addr, opts], tries=8)
        rows = r.get('data') or []; out += rows; CREDITS[0] += max(10, -(-len(rows) // 100) * 10)
        tok = r.get('paginationToken')
        if not tok or not rows: return out


def backfill(mint, quote, T, people, wallets, since):
    px = {m: series(m, since, price.get(m, 0)) for m in (mint, quote, SOL)}; pt = {m: [t for t, _ in s] for m, s in px.items()}   # first: free
    qprog = rpc('getAccountInfo', [quote, {'encoding': 'base64', 'dataSlice': {'offset': 0, 'length': 0}}])['value']['owner']

    def one(w):
        seen, txs = set(), []
        for addr in (pda([b58d(w), b58d(T['prog']), b58d(mint)], ATA), pda([b58d(w), b58d(qprog), b58d(quote)], ATA)):
            for tx in history(addr, since):
                sig = tx['transaction']['signatures'][0]
                if sig in seen or (tx.get('meta') or {}).get('err'): continue
                seen.add(sig); m = tx['meta']; keys = [k['pubkey'] for k in tx['transaction']['message']['accountKeys']]
                ch = {}
                for side, sgn in (('preTokenBalances', -1), ('postTokenBalances', 1)):
                    for b in m.get(side) or []:
                        if b.get('owner') == w:
                            ch[b['mint']] = ch.get(b['mint'], 0) + sgn * float((b.get('uiTokenAmount') or {}).get('uiAmountString') or 0)
                if w in keys:
                    i = keys.index(w); ch[SOL] = ch.get(SOL, 0) + (m['postBalances'][i] - m['preBalances'][i] + (m.get('fee', 0) if i == 0 else 0)) / 1e9
                ch = {k: v for k, v in ch.items() if abs(v) > 1e-9}
                if ch: txs.append({'t': tx.get('blockTime') or now, 'ch': ch, 'signer': keys[0] == w})
        return w, sorted(txs, key=lambda x: x['t'])
    with ThreadPoolExecutor(2) as ex: hist = dict(ex.map(one, wallets))   # 2 at a time: Helius' free plan refuses bursts

    def usd(m, a, t):
        if m in STABLE: return a
        s = px.get(m)
        if not s: return 0.0
        return a * s[max(bisect.bisect_right(pt[m], t) - 1, 0)][1]

    # payouts: reward tokens in, nothing else moved, not signed by the holder; this token's rounds pay every holder at
    # one rate (reward tokens per token held) at one moment, so only payouts at the rate most of a burst agrees on count
    events = []
    for w, txs in hist.items():
        bal = people.get(w, 0)
        for tx in reversed(txs): tx['before'] = bal - tx['ch'].get(mint, 0); bal = tx['before']
        for tx in txs:
            a = tx['ch'].get(quote, 0)
            if a > 0 and not tx['signer'] and all(abs(v) < 1e-6 for k, v in tx['ch'].items() if k != quote) and tx['before'] > 0:
                events.append({'w': w, 't': tx['t'], 'rate': a / tx['before'], 'tx': tx})
    events.sort(key=lambda e: e['t']); rounds = 0; burst = []
    def close(B):
        nonlocal rounds
        if len(B) < 3: return
        best = max(B, key=lambda e: sum(1 for f in B if abs(f['rate'] / e['rate'] - 1) <= 0.2))
        r = median(f['rate'] for f in B if abs(f['rate'] / best['rate'] - 1) <= 0.2)
        mine = [f for f in B if abs(f['rate'] / r - 1) <= 0.2]
        if len({f['w'] for f in mine}) >= 3:
            rounds += 1
            for f in mine: f['tx']['mine'] = True
    for e in events:
        if burst and e['t'] - burst[-1]['t'] > 900: close(burst); burst = []
        burst.append(e)
    close(burst)

    T['days'] = {}
    for w, txs in hist.items():
        for tx in txs:
            t, ch = tx['t'], tx['ch']; day = t // DAY
            if tx.get('mine'): add(T, w, day, R=usd(quote, ch[quote], t)); continue
            dx = ch.get(mint, 0)
            other = {m: v for m, v in ch.items() if m != mint and not (m == SOL and abs(v) < 0.01)}
            out_ = sum(-usd(m, v, t) for m, v in other.items() if v < 0); in_ = sum(usd(m, v, t) for m, v in other.items() if v > 0)
            if dx > 0 and out_ > 0: add(T, w, day, B=out_)
            elif dx < 0 and in_ > 0: add(T, w, day, S=in_)
    log(f"  backfill: {len(events)} payouts, {sum(1 for e in events if e['tx'].get('mine'))} from this token's {rounds} rounds")


# ---------- score ----------
def score(days, since_day):
    """days: {day: [R, B, S]} -> (R, N, c, k, score, tag) over the days from since_day, counting from the first reward."""
    ds = sorted((int(d), v) for d, v in days.items() if int(d) >= since_day)
    first = next((d for d, v in ds if v[0] > 0), None)
    if first is None: return None
    R = sum(v[0] for d, v in ds); ds = [(d, v) for d, v in ds if d >= first]
    B = sum(v[1] for d, v in ds); S = sum(v[2] for d, v in ds); N = B - S
    bought = {d for d, v in ds if v[1] > 0}; rd = [d for d, v in ds if v[0] > 0]
    c = min(max(N, 0), R) / R if R else 0; k = sum(1 for d in rd if d in bought or d + 1 in bought) / len(rd)
    sc = round(100 * (0.7 * c + 0.3 * k)) if N >= 0 else 0
    tag = 'Seller' if N < 0 else 'Compounder' if c >= 0.5 else 'Partial' if c >= 0.1 else 'Collector'
    return [round(R, 2), round(N, 2), round(c, 3), round(k, 3), sc, tag]


WINDOWS = {'7d': 7, '30d': 30, 'all': KEEP_DAYS}
index = load('compound/index.json', {'tokens': {}})
for mint in watch:
    T = ST.setdefault(mint, {})
    if not BACKFILL and T.get('at') and now - T['at'] < 6 * 3600 - 900: continue   # every 6 h (the workflow also runs 6-hourly)
    if BACKFILL and (T.get('backfilled') or mint not in backfill_set): continue
    try:
        rw = G[mint]; quote = (rw.get('quote') or {}).get('mint')
        if not quote: continue
        sym, qsym = names.get(mint) or mint[:4], (rw.get('quote') or {}).get('symbol')
        xpx, qpx = price.get(mint, 0), price.get(quote, 0)
        dist = float(rw.get('distributedTokens') or 0); minusd = 20   # stonkfun's minimum holding ($20 on every token so far)
        if not xpx or not qpx: log(f'${sym}: no price, skipped this run'); continue
        people = holders(mint, T)
        elig = sum(b for b in people.values() if b * xpx >= minusd) if xpx else sum(people.values())
        wallets = top_set(people); total = sum(people.values()) or 1
        log(f"${sym}: {len(people)} holders, {len(wallets)} wallets own {sum(people[w] for w in wallets) / total * 100:.0f}% · eligible {elig:,.0f}")
        if BACKFILL:
            backfill(mint, quote, T, people, wallets[:BACKFILL_W], now - BACKFILL_DAYS * DAY); T['backfilled'] = now; T['since'] = now - BACKFILL_DAYS * DAY
        elif T.get('at') and T.get('bal') is not None:
            dD = max(dist - T.get('dist', dist), 0); E = (elig + T.get('elig', elig)) / 2 or 1
            for w in set(wallets) | set(T['bal']):
                b0, b1 = T['bal'].get(w), people.get(w, 0)
                if b0 is None: continue                               # new to the list: no earlier balance to compare
                avg = (b0 + b1) / 2
                R = dD * avg / E * qpx if avg * xpx >= minusd else 0
                d = b1 - b0
                add(T, w, today, R=R, B=max(d, 0) * xpx if b0 > 0 else 0, S=max(-d, 0) * xpx)
        T.setdefault('since', now)
        T.update({'at': now, 'dist': dist, 'elig': elig, 'sym': sym, 'qsym': qsym,
                  'bal': {w: round(people.get(w, 0), 6) for w in wallets}})
        cut = today - KEEP_DAYS                                        # forget days past 90 and wallets with nothing left
        T['days'] = {w: {d: v for d, v in dd.items() if int(d) > cut} for w, dd in (T.get('days') or {}).items()}
        T['days'] = {w: dd for w, dd in T['days'].items() if dd}

        # ---------- the token page's file ----------
        rows, summ = [], {}
        for w in wallets:
            r = {'w': w, 'p': round(people[w] / total * 100, 3)}
            for k_, n in WINDOWS.items(): r[k_] = score((T['days'].get(w) or {}), today - n + 1)
            rows.append(r)
        for k_ in WINDOWS:
            S_ = [r for r in rows if r[k_]]; W_ = sum(r['p'] for r in S_) or 1; RR = sum(r[k_][0] for r in S_) or 1
            summ[k_] = {'score': round(sum(r['p'] * r[k_][4] for r in S_) / W_, 1) if S_ else None,
                        'compounded': round(100 * sum(min(r[k_][0], max(r[k_][1], 0)) for r in S_) / RR, 1) if S_ else None,
                        'fresh': round(sum(max(r[k_][1], 0) for r in S_) / RR, 2) if S_ else None,
                        'rewards': round(sum(r[k_][0] for r in S_)), 'scored': len(S_),
                        'tags': {t: [sum(1 for r in S_ if r[k_][5] == t), round(sum(r['p'] for r in S_ if r[k_][5] == t), 2)]
                                 for t in ('Compounder', 'Partial', 'Collector', 'Seller')}}
        page = {'mint': mint, 'sym': sym, 'quote': qsym, 'at': now, 'since': T['since'], 'holders': len(people),
                'wallets': len(wallets), 'cover': round(sum(people[w] for w in wallets) / total * 100, 1), 'win': summ, 'rows': rows}
        save(f'compound/{mint}.json', page)
        index['tokens'][mint] = {'sym': sym, 'at': now, 'since': T['since'], 'wallets': len(wallets), 'holders': len(people),
                                 'score': {k_: summ[k_]['score'] for k_ in WINDOWS}}
        log(f"  score 7d {summ['7d']['score']} · 30d {summ['30d']['score']} · credits so far {CREDITS[0]}")
        if BACKFILL: save('compound/index.json', index); save('compound-state.json', state)   # a run cut short keeps what it did
    except Exception as e: log(mint[:6], 'failed:', e)
# tokens the site no longer lists: off the index now, their saved numbers dropped after 7 days
index['tokens'] = {m: v for m, v in index['tokens'].items() if m in watch}
for m in [m for m, T in ST.items() if m not in watch and now - T.get('at', 0) > 7 * DAY]: del ST[m]
index['at'] = now
save('compound/index.json', index); save('compound-state.json', state)
log('calls', CALLS, '· estimated Helius credits', CREDITS[0])
