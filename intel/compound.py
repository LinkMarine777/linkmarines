#!/usr/bin/env python3
"""Compounding: are the holders of stonkfun's reward tokens putting their rewards back into the token?

Runs every 6 h on GitHub Actions (.github/workflows/compound.yml) for every reward token the site lists ($MARINE,
stonkfun's top 30 and the Stonk Board's top 100, ~100 tokens) and writes into the data branch:
  terminal/compound/<mint>.json   what the token page reads: the token's compound score, tags, and one row per wallet
  terminal/compound/index.json    every tracked token's summary (scores for 7d / 30d / all)
  terminal/compound-state.json    memory between runs: last balances, payout total and daily numbers per wallet

Wallets: the fewest that together own 80% of the token's supply held by people (pools, lockers, token / program accounts excluded),
at least 20 and at most 600 ($MARINE ~85, $ZCAT ~460).

Every run: stonkfun's payout totals for all tokens (one call) and prices (Jupiter, 50 tokens a call); per token a few
Helius credits (getProgramAccountsV2, 1 credit per 10,000 accounts; ~15-30K credits a month for ~100 tokens):
  - every holder's balance (one getProgramAccounts) and stonkfun's payout total for the token (distributedTokens)
  - rewards since the last run: the payout total's growth x the wallet's share of the eligible supply (wallets worth at
    least stonkfun's minimum holding). Checked against each payout read one by one for $MARINE's top 20: within ~2%.
  - buying / selling: the change in the wallet's balance (moving tokens between your own wallets looks like a trade)
  added to the wallet's numbers for that day (UTC), kept 90 days.
--history: every token's whole history since launch, read the cheap way (each wallet's token account + the 8 biggest
wallets' reward accounts for the payout rounds; see history_fill), once; resumable, stops at a credit / time limit.
--backfill ($MARINE + stonkfun's top 10 by market cap only): the last 7 days read exactly instead (each wallet's token account + reward-token account; payouts counted
only when they match one of the token's own payout rounds, since stonkfun pays every LINK / ZEC / ... token from shared
wallets) for each token's 200 biggest wallets, then the 6-hourly runs carry on from there (the rest start then).
One-off: ~45K credits for all 11 tokens (two reads per wallet, 10+ credits each).

Score per wallet over a window, counting from its first reward (the buy that got it in isn't compounding):
  R = rewards ($), N = net bought ($), c = min(max(N, 0), R) / R, k = share of reward days with a buy that day or the next
  e = buying beyond the rewards: min(1, log2(N / R) / 3) when N > R (2x = 1/3, 4x = 2/3, 8x+ = 1)
  score = 100 x (0.6 c + 0.25 k + 0.15 e), 0 for a net seller · Compounder c >= 50% · Partial 10-50% · Collector < 10% · Seller N < 0
Token score: the wallets' scores weighted by how much they hold.
Never prints the RPC URL.
"""
import base64, bisect, calendar, json, math, os, re, struct, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
from statistics import median
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pda import b58d, b58e, on_curve, pda, ATA

OUT = sys.argv[1] if len(sys.argv) > 1 else 'terminal'
BACKFILL = '--backfill' in sys.argv
HISTORY = '--history' in sys.argv   # every token's whole history since launch, once (resumable; see history_fill)
KEY = os.environ.get('HELIUS_KEY', '').strip(); URL = os.environ.get('SOLANA_RPC', '').strip()
RPC = URL or (f'https://mainnet.helius-rpc.com/?api-key={KEY}' if KEY else 'https://api.mainnet-beta.solana.com')
SF = 'https://www.stonkfun.xyz'
MARINE = 'F8Sc8HoZvJcMrTY6vBsetTqGPv6XQmM2XgVAZo1sSTNK'
SOL = 'So11111111111111111111111111111111111111112'
STABLE = {'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'}
NOT_WALLETS = {'5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1', 'GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL',
               'WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh', 'HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC'}
DAY, KEEP_DAYS, COVER, MIN_W, MAX_W = 86400, 180, 0.8, 20, 600
BACKFILL_W, BACKFILL_DAYS = int(os.environ.get('BACKFILL_W', 200)), int(os.environ.get('BACKFILL_DAYS', 7))
HISTORY_BUDGET = int(os.environ.get('HISTORY_BUDGET', 160000))   # credits one history run may spend before it stops starting tokens
HISTORY_MINUTES = int(os.environ.get('HISTORY_MINUTES', 110))      # ... or minutes (the job has 140); the next run carries on
# trade by trade (off until the Helius plan has room, ~1M credits a month): in the 6-hourly update, a wallet whose balance moved
# has its actual transactions read, so a buy / sell is the real swap at its own time and a plain transfer counts as neither.
# Off: buys and sells are the balance changes between snapshots. TRADES_BUDGET caps it per run (then balance changes again)
TRADES = os.environ.get('TRADES', '') == '1'
TRADES_BUDGET = int(os.environ.get('TRADES_BUDGET', 20000))
ACCTS = {}   # wallet -> its token accounts for the token being updated (filled by holders())
PAGES = int(os.environ.get('PAGES', 80))   # most pages a big token's holder lookup may take (1,000 holders, 10 credits each)
now = int(time.time()); today = now // DAY
CALLS, CREDITS = {}, [0]


def log(*a):
    out = ' '.join(str(x) for x in a)
    for k in (KEY, URL):
        if k: out = out.replace(k, '***')
    print(out, flush=True)


def get(url, tries=5):
    for i in range(tries):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'war-room-compound'}), timeout=30))
        except Exception as e:
            if i == tries - 1: raise
            time.sleep(15 * (i + 1) if '429' in str(e) else 2)   # GeckoTerminal's limit resets within a minute


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
bonded = {m: b.get('bondedAt') for m, b in board.items() if b.get('bondedAt')}
bonded.update({t['mint']: t['bondedAt'] for t in toks if t.get('bondedAt')})
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
KINDS = state.setdefault('kinds', {})   # owner → 0 a person (System-owned, or no account), 1 not (a token or program account)
SYSTEM = '11111111111111111111111111111111'


def people_only(people):
    """Drop owners that are a program's accounts with an ordinary key, which the PDA check can't see (a token account holding
    tokens, a program-held vault): a person's wallet is owned by the System program, or holds no SOL at all. Only the wallets
    that could make the tracked set are looked up, once each (getMultipleAccounts, 100 a call)."""
    for _ in range(5):
        ask = [w for w in sorted(people, key=lambda w: -people[w])[:MAX_W + 100] if w not in KINDS]
        if not ask: break
        for i in range(0, len(ask), 100):
            v = rpc('getMultipleAccounts', [ask[i:i + 100], {'encoding': 'base64', 'dataSlice': {'offset': 0, 'length': 0}}])['value']; CREDITS[0] += 1
            for w, a in zip(ask[i:i + 100], v): KINDS[w] = 0 if a is None or a['owner'] == SYSTEM else 1
        people = {w: b for w, b in people.items() if not KINDS.get(w)}
    return {w: b for w, b in people.items() if not KINDS.get(w)}


def holders(mint, T):
    """Every wallet's balance (people only: pool authorities and program-owned accounts are skipped)."""
    if 'prog' not in T:
        T['prog'] = rpc('getAccountInfo', [mint, {'encoding': 'base64', 'dataSlice': {'offset': 0, 'length': 0}}])['value']['owner']
        T['dec'] = rpc('getTokenSupply', [mint])['value']['decimals']
    own = {}; ACCTS.clear()
    if not T.get('big'):
        try:
            accs = rpc('getProgramAccounts', [T['prog'], {'encoding': 'base64', 'dataSlice': {'offset': 32, 'length': 40},
                                                          'filters': [{'memcmp': {'offset': 0, 'bytes': mint}}]}]); CREDITS[0] += 10
            for a in accs:
                raw = base64.b64decode(a['account']['data'][0])
                if len(raw) < 40: continue
                o = b58e(raw[:32]); own[o] = own.get(o, 0) + struct.unpack('<Q', raw[32:40])[0] / 10 ** T['dec']; ACCTS.setdefault(o, []).append(a['pubkey'])
        except RuntimeError as e:
            if not re.search(r'Too many accounts|deprioritized|getProgramAccountsV2', str(e)) or not (KEY or 'helius' in URL): raise   # Helius' wording varies
            T['big'] = True; log('  too many accounts for one call: holder lookup by mint from now on (every 24 h)')
    if T.get('big'):   # Helius' token-holder lookup by mint: 1,000 accounts a page, 10 credits a page
        cur, pages, done = None, 0, False
        while pages < PAGES:
            r = rpc('getTokenAccounts', {'mint': mint, 'limit': 1000, **({'cursor': cur} if cur else {})}); CREDITS[0] += 10; pages += 1
            L = r.get('token_accounts') or []
            for a in L:
                own[a['owner']] = own.get(a['owner'], 0) + float(a.get('amount') or 0) / 10 ** T['dec']
                if a.get('address'): ACCTS.setdefault(a['owner'], []).append(a['address'])
            cur = r.get('cursor')
            if not L or not cur or len(L) < 1000: done = True; break
        if not done: raise RuntimeError(f'holder list incomplete after {pages} pages')   # never save a partial snapshot
    out = {o: b for o, b in own.items() if b > 0 and o not in NOT_WALLETS and on_curve(b58d(o))}
    if not out: raise RuntimeError('no holders returned')
    return people_only(out)


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


PXC = {}   # price histories already fetched this run (SOL and shared reward tokens are needed by many tokens)


def series_long(mint, since, now_px):
    """Hourly $ prices back to `since` (GeckoTerminal, 1,000 hours a call, fetched once per run); today's price if it won't answer."""
    c = PXC.get(mint)
    if c and c[0] <= since: return c[1]
    out = series_long_gt(mint, since, now_px)
    if len(out) > 1: PXC[mint] = (out[0][0], out)
    return out


def series_long_gt(mint, since, now_px):
    try:
        time.sleep(2.2)
        p = get(f'https://api.geckoterminal.com/api/v2/networks/solana/tokens/{mint}/pools?page=1')
        pool = p['data'][0]; side = 'base' if pool['relationships']['base_token']['data']['id'].endswith(mint) else 'quote'
        out, before = [], now
        for _ in range(6):
            if before <= since: break
            time.sleep(3)   # GeckoTerminal allows ~30 calls a minute
            r = get(f"https://api.geckoterminal.com/api/v2/networks/solana/pools/{pool['attributes']['address']}/ohlcv/hour?aggregate=1&limit=1000&before_timestamp={before}&token={side}")
            rows = r['data']['attributes']['ohlcv_list']
            if not rows or min(int(x[0]) for x in rows) >= before: break
            out += [(int(x[0]), float(x[4])) for x in rows]; before = min(int(x[0]) for x in rows)
        return sorted(set(out)) or [(since, now_px)]
    except Exception as e: log('  price history unavailable, using the current price:', mint[:6], e); return [(since, now_px)] if now_px else []


def deltas(tx, w):
    """What one transaction did to wallet w: {mint: change} (SOL included, fee back out), and whether w signed it."""
    m = tx['meta']; keys = [k['pubkey'] for k in tx['transaction']['message']['accountKeys']]; ch = {}
    for side, sgn in (('preTokenBalances', -1), ('postTokenBalances', 1)):
        for b in m.get(side) or []:
            if b.get('owner') == w:
                ch[b['mint']] = ch.get(b['mint'], 0) + sgn * float((b.get('uiTokenAmount') or {}).get('uiAmountString') or 0)
    if w in keys:
        i = keys.index(w); ch[SOL] = ch.get(SOL, 0) + (m['postBalances'][i] - m['preBalances'][i] + (m.get('fee', 0) if i == 0 else 0)) / 1e9
    return {k: v for k, v in ch.items() if abs(v) > 1e-9}, keys[0] == w


def find_rounds(ev):
    """Payout events {w, t, rate} -> this token's payout batches. One batch pays every holder at one rate (reward tokens per
    token held) within minutes; a round can be several batches minutes apart at slightly different rates, and other tokens'
    payouts land in the same account. A payout joins an open batch within 30 min whose rate is within 3% and that hasn't
    paid that wallet yet, else opens a new one; batches at least 2 wallets agree on are kept. Returns [{t, rate, ev}]."""
    open_, done = [], []
    for e in sorted(ev, key=lambda e: e['t']):
        for b in [b for b in open_ if e['t'] - b['t'] > 1800]: open_.remove(b); done.append(b)
        b = next((b for b in open_ if e['w'] not in b['ws'] and abs(e['rate'] / b['rate'] - 1) <= 0.03), None)
        if b: b['ev'].append(e); b['ws'].add(e['w'])
        else: open_.append({'t': e['t'], 'rate': e['rate'], 'ev': [e], 'ws': {e['w']}})
    return [{'t': b['t'], 'rate': median(f['rate'] for f in b['ev']), 'ev': b['ev']} for b in done + open_ if len(b['ws']) >= 2]


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
    found = find_rounds(events); rounds = len(found)
    for b in found:
        for f in b['ev']: f['tx']['mine'] = True

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


# ---------- whole history since launch (--history) ----------
# Cheaper than reading every payout: each wallet's token account only (its buys, sells and balance over time: usually one
# read), plus the reward account of the 8 biggest wallets to find every payout round and its rate (reward tokens per token
# held, the same for everyone in a round). A wallet's reward in a round = the rate x its balance then (if worth $20+).
# Checked against payouts read one by one for $MARINE's top 20: ~2%. ~1.5K credits a token.
def swaps(mint, quote, T, w, since, xpx, qpx):
    """Trade by trade: wallet w's swaps of the token since `since`, as (day, bought $, sold $). A buy is the token coming in
    while SOL / the reward token / a stable goes out (a sell the reverse); a transfer (nothing else moves) is neither. Valued
    at today's prices (the window is 6 h); a swap against something unpriced is valued by the token side."""
    px = {mint: xpx, quote: qpx, SOL: price.get(SOL, 0)}
    val = lambda m, a: abs(a) * (1.0 if m in STABLE else px.get(m, 0))
    out, seen = [], set()
    for acct in ACCTS.get(w) or [pda([b58d(w), b58d(T['prog']), b58d(mint)], ATA)]:   # the wallet's real token accounts (not always the standard one)
        for tx in history(acct, since):
            sig = (tx.get('transaction') or {}).get('signatures', [None])[0]
            if sig in seen or (tx.get('meta') or {}).get('err'): continue
            seen.add(sig)
            ch, signer = deltas(tx, w); dx = ch.get(mint, 0)
            other = {m: v for m, v in ch.items() if m != mint and not (m == SOL and abs(v) < 0.01)}   # SOL dust = fees / rent
            if not dx or not other: continue                                                        # a transfer: not a trade
            day = (tx.get('blockTime') or now) // DAY
            if dx > 0 and any(v < 0 for v in other.values()): out.append((day, sum(val(m, v) for m, v in other.items() if v < 0) or dx * xpx, 0))
            elif dx < 0 and any(v > 0 for v in other.values()): out.append((day, 0, sum(val(m, v) for m, v in other.items() if v > 0) or -dx * xpx))
    return out


def history_fill(mint, quote, T, people, wallets, since):
    px = {m: series_long(m, since, price.get(m, 0)) for m in (mint, quote, SOL)}; pt = {m: [t for t, _ in s] for m, s in px.items()}
    def at(m, t):
        if m in STABLE: return 1.0
        s = px.get(m)
        return s[max(bisect.bisect_right(pt[m], t) - 1, 0)][1] if s else 0.0
    qprog = rpc('getAccountInfo', [quote, {'encoding': 'base64', 'dataSlice': {'offset': 0, 'length': 0}}])['value']['owner']
    xata = lambda w: pda([b58d(w), b58d(T['prog']), b58d(mint)], ATA)
    def trades(w):   # the wallet's token account: every change to its balance since launch, oldest first
        out = []
        for tx in history(xata(w), since):
            if (tx.get('meta') or {}).get('err'): continue
            ch, signer = deltas(tx, w)
            if ch.get(mint): out.append({'t': tx.get('blockTime') or now, 'ch': ch})
        out.sort(key=lambda x: x['t']); bal = people.get(w, 0)
        for x in reversed(out): x['after'] = bal; bal -= x['ch'][mint]; x['before'] = bal
        return w, out
    with ThreadPoolExecutor(2) as ex: H = dict(ex.map(trades, wallets))
    def bal_at(w, t):
        L = H.get(w) or []
        i = bisect.bisect_right([x['t'] for x in L], t) - 1
        return L[i]['after'] if i >= 0 else (L[0]['before'] if L else people.get(w, 0))

    # payout rounds: the biggest wallets' reward accounts; a burst's payouts that agree on one rate are this token's round
    ev = []
    for w in wallets[:8]:
        for tx in history(pda([b58d(w), b58d(qprog), b58d(quote)], ATA), since):
            if (tx.get('meta') or {}).get('err'): continue
            ch, signer = deltas(tx, w); a = ch.get(quote, 0); t = tx.get('blockTime') or now; b = bal_at(w, t)
            if a > 0 and not signer and b > 0 and all(abs(v) < 1e-6 for k, v in ch.items() if k != quote): ev.append({'w': w, 't': t, 'rate': a / b})
    rounds = [(b['t'], b['rate']) for b in find_rounds(ev)]

    T['days'] = {}
    for t, r in rounds:
        for w in wallets:
            b = bal_at(w, t)
            if b > 0 and b * at(mint, t) >= 20: add(T, w, t // DAY, R=b * r * at(quote, t))
    for w, L in H.items():
        for x in L:
            t, ch = x['t'], x['ch']; dx = ch[mint]
            other = {m: v for m, v in ch.items() if m != mint and not (m == SOL and abs(v) < 0.01)}
            out_ = sum(-v * at(m, t) for m, v in other.items() if v < 0); in_ = sum(v * at(m, t) for m, v in other.items() if v > 0)
            if dx > 0 and out_ > 0: add(T, w, t // DAY, B=out_)
            elif dx < 0 and in_ > 0: add(T, w, t // DAY, S=in_)
    log(f"  history since {time.strftime('%Y-%m-%d', time.gmtime(since))}: {len(rounds)} payout rounds, {sum(len(L) for L in H.values())} trades")
    if os.environ.get('DEBUG'): T['dbg'] = {'rounds': rounds, 'events': [(e['w'][:6], e['t'], e['rate']) for e in ev]}


# ---------- score ----------
def score(days, since_day):
    """days: {day: [R, B, S]} -> (R, N, c, k, score, tag, B, S) over the days from since_day, counting from the first reward."""
    allds = sorted((int(d), v) for d, v in days.items())
    first_ever = next((d for d, v in allds if v[0] > 0), None)   # the day of the wallet's very first reward: its entry buy is
    ds = [(d, v) for d, v in allds if d >= since_day]             # usually that day too, so that day's trades don't count
    first = next((d for d, v in ds if v[0] > 0), None)
    if first is None: return None
    R = sum(v[0] for d, v in ds); ds = [(d, v) for d, v in ds if d >= first]
    B = sum(v[1] for d, v in ds if d != first_ever); S = sum(v[2] for d, v in ds if d != first_ever); N = B - S
    bought = {d for d, v in ds if v[1] > v[2] and d != first_ever}; rd = [d for d, v in ds if v[0] > 0]   # a day counts when they bought more than they sold
    c = min(max(N, 0), R) / R if R else 0; k = sum(1 for d in rd if d in bought or d + 1 in bought) / len(rd)
    e = min(1, math.log2(N / R) / 3) if R and N > R else 0   # buying beyond the rewards: 2x = 1/3, 4x = 2/3, 8x+ = all of it
    sc = round(100 * (0.6 * c + 0.25 * k + 0.15 * e)) if N >= 0 else 0
    tag = 'Seller' if N < 0 else 'Compounder' if c >= 0.5 else 'Partial' if c >= 0.1 else 'Collector'
    return [round(R, 2), round(N, 2), round(c, 3), round(k, 3), sc, tag, round(B, 2), round(S, 2)]   # + bought, sold (the page's detail line)


WINDOWS = {'7d': 7, '30d': 30, 'all': KEEP_DAYS}
NEW_HIST = [0]   # coins new to the site that got their history filled this run (at most 3 a run, to cap credits)


CAP, MIN_N, MIN_R = 0.15, 10, 2000   # no wallet over 15% of a token's score; under 10 scored wallets or $2K of rewards = low data


def capped(ps):
    """Holding weights (as shares) with no wallet over CAP: the capped wallets get CAP each, the rest share what's left in
    proportion (one big holder can't be the whole score); with too few wallets for the cap, they're equal."""
    n = len(ps)
    if not n: return []
    if n * CAP <= 1: return [1 / n] * n
    fixed = set()
    while True:
        free = [i for i in range(n) if i not in fixed]; sf = sum(ps[i] for i in free) or 1; rem = 1 - CAP * len(fixed)
        over = [i for i in free if ps[i] / sf * rem > CAP]
        if not over: return [CAP if i in fixed else ps[i] / sf * rem for i in range(n)]
        fixed |= set(over)


def summarize(rows):
    """The token's numbers per window from its wallets' rows: holding-weighted score (capped), % of rewards put back, new
    money, tags, and whether there's enough behind it (low) and how much the biggest wallet holds of the tracked supply (top1)."""
    summ = {}
    for k_ in WINDOWS:
        S_ = [r for r in rows if r[k_]]; RR = sum(r[k_][0] for r in S_) or 1
        wt = capped([r['p'] for r in S_]); W_ = sum(wt) or 1; P_ = sum(r['p'] for r in S_) or 1
        summ[k_] = {'score': round(sum(w * r[k_][4] for w, r in zip(wt, S_)) / W_, 1) if S_ else None,
                    'compounded': round(100 * sum(min(r[k_][0], max(r[k_][1], 0)) for r in S_) / RR, 1) if S_ else None,
                    'fresh': round(sum(max(r[k_][1], 0) for r in S_) / RR, 2) if S_ else None,
                    'rewards': round(sum(r[k_][0] for r in S_)), 'scored': len(S_),
                    'low': len(S_) < MIN_N or RR < MIN_R, 'top1': round(100 * max([r['p'] for r in S_] or [0]) / P_, 1),
                    'tags': {t: [sum(1 for r in S_ if r[k_][5] == t), round(sum(r['p'] for r in S_ if r[k_][5] == t), 2)]
                             for t in ('Compounder', 'Partial', 'Collector', 'Seller')}}
    return summ


index = load('compound/index.json', {'tokens': {}})
if '--rescore' in sys.argv:   # the score formula changed: rebuild every token's page from the saved daily numbers, no RPC at all
    for mint, it in index['tokens'].items():
        page, T = load(f'compound/{mint}.json', None), ST.get(mint)
        if not page or not T: continue
        people_only({r['w']: r['p'] for r in page['rows']})
        page['rows'] = [r for r in page['rows'] if not KINDS.get(r['w'])]; page['wallets'] = len(page['rows'])
        for r in page['rows']:
            for k_, n in WINDOWS.items(): r[k_] = score((T.get('days') or {}).get(r['w']) or {}, today - n + 1)
        page['win'] = summ = summarize(page['rows']); save(f'compound/{mint}.json', page)
        it.update({'score': {k_: summ[k_]['score'] for k_ in WINDOWS}, 'c7': summ['7d']['compounded'], 'r7': summ['7d']['rewards'],
                   'ca': summ['all']['compounded'], 'ra': summ['all']['rewards'], 'wallets': page['wallets'], 'big': bool(T.get('big')), 'low': summ['all']['low']})
    save('compound/index.json', index); save('compound-state.json', state); log(f"rescored {len(index['tokens'])} tokens"); sys.exit(0)
for mint in watch:
    T = ST.setdefault(mint, {})
    if not T.get('v2') and len(T.get('bal') or {}) < MIN_W and not T.get('backfilled'):   # one-off: partial snapshots an earlier run saved
        for k in ('at', 'bal', 'dist', 'elig', 'days', 'since'): T.pop(k, None)
    gap = (24 if T.get('big') else 6) * 3600   # big tokens (holder lookup by mint, 10 credits per 1,000) once a day
    # every 6 h: the workflow runs 6-hourly but reaches each token at a different minute, so anything over 4 h old is due (with
    # 15 min of slack, tokens updated late in one run were skipped by the next and went 12 h)
    if not BACKFILL and not HISTORY and T.get('at') and T.get('bal') and now - T['at'] < gap - 2 * 3600: continue
    if BACKFILL and (T.get('backfilled') or mint not in backfill_set): continue
    if HISTORY and (T.get('history') or CREDITS[0] > HISTORY_BUDGET or time.time() - now > HISTORY_MINUTES * 60): continue
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
        new_coin = not HISTORY and not BACKFILL and not T.get('history') and NEW_HIST[0] < 3   # a coin new to the site gets its
        if new_coin: NEW_HIST[0] += 1                                                            # whole history on its first run
        if HISTORY or new_coin:
            since = calendar.timegm(time.strptime(bonded[mint][:19], '%Y-%m-%dT%H:%M:%S')) if bonded.get(mint) else now - KEEP_DAYS * DAY
            since = max(since, now - KEEP_DAYS * DAY)
            history_fill(mint, quote, T, people, wallets[:int(os.environ.get('HISTORY_W', MAX_W))], since); T['history'] = now; T['since'] = since
            if new_coin: log(f'  new coin: whole history filled ({CREDITS[0]} credits so far)')
        elif BACKFILL:
            backfill(mint, quote, T, people, wallets[:BACKFILL_W], now - BACKFILL_DAYS * DAY); T['backfilled'] = now; T['since'] = now - BACKFILL_DAYS * DAY
        elif T.get('at') and T.get('bal') is not None:
            dD = max(dist - T.get('dist', dist), 0); E = (elig + T.get('elig', elig)) / 2 or 1
            for w in set(wallets) | set(T['bal']):
                b0, b1 = T['bal'].get(w), people.get(w, 0)
                if b0 is None: continue                               # new to the list: no earlier balance to compare
                avg = (b0 + b1) / 2
                R = dD * avg / E * qpx if avg * xpx >= minusd else 0
                d = b1 - b0
                if TRADES and b0 > 0 and abs(d) * xpx >= 1 and CREDITS[0] < TRADES_BUDGET:
                    add(T, w, today, R=R)
                    for day, B_, S_ in swaps(mint, quote, T, w, T['at'], xpx, qpx): add(T, w, day, B=B_, S=S_)
                else: add(T, w, today, R=R, B=max(d, 0) * xpx if b0 > 0 else 0, S=max(-d, 0) * xpx)
        T.setdefault('since', now)
        T.update({'at': now, 'dist': dist, 'elig': elig, 'sym': sym, 'qsym': qsym, 'v2': True,
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
        summ = summarize(rows)
        page = {'mint': mint, 'sym': sym, 'quote': qsym, 'at': now, 'since': T['since'], 'holders': len(people),
                'wallets': len(wallets), 'cover': round(sum(people[w] for w in wallets) / total * 100, 1), 'win': summ, 'rows': rows}
        save(f'compound/{mint}.json', page)
        index['tokens'][mint] = {'sym': sym, 'at': now, 'since': T['since'], 'wallets': len(wallets), 'holders': len(people), 'big': bool(T.get('big')),   # big: refreshed daily
                                 'score': {k_: summ[k_]['score'] for k_ in WINDOWS},
                                 'c7': summ['7d']['compounded'], 'r7': summ['7d']['rewards'],    # % put back, $ rewards: 7 days
                                 'ca': summ['all']['compounded'], 'ra': summ['all']['rewards'],  # ... and since launch (what the site shows)
                                 'low': summ['all']['low']}   # too little behind it to rank
        log(f"  score 7d {summ['7d']['score']} · 30d {summ['30d']['score']} · credits so far {CREDITS[0]}")
        if BACKFILL or HISTORY: save('compound/index.json', index); save('compound-state.json', state)   # a run cut short keeps what it did
    except Exception as e: log(mint[:6], 'failed:', e)
# tokens the site no longer lists: off the index now, their saved numbers dropped after 7 days
index['tokens'] = {m: v for m, v in index['tokens'].items() if m in watch}
for m in [m for m, T in ST.items() if m not in watch and now - T.get('at', 0) > 7 * DAY]: del ST[m]
index['at'] = now
save('compound/index.json', index); save('compound-state.json', state)
log('calls', CALLS, '· estimated Helius credits', CREDITS[0])
