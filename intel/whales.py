#!/usr/bin/env python3
"""Whale radar: what the biggest holders of stonkfun's top tokens are buying and selling.

Runs on GitHub Actions every 30 min (.github/workflows/whales.yml) and writes into the data branch:
  terminal/whales.json        what the terminals read: what whales are buying / selling, signals, recent swaps
  terminal/whales-state.json  memory between runs: last transaction seen per wallet, swaps of the last 3 days

Whales = the top 20 wallets of $MARINE and of stonkfun's top 10 by market cap, straight from the chain
(getTokenLargestAccounts, refreshed every 6 h), minus each token's own pool. For each whale only the transactions since
the last run are read, so a run is a few hundred RPC calls. Everything here is free: Solana RPC (your Helius key when
the HELIUS_KEY secret is set, never printed; else the public nodes), stonkfun's public API, Jupiter for names + prices.

Signals (each fires once):
  convergence  3+ different whales bought the same token in 24 h
  rotation     a whale sold the token they're a whale of and bought another one
  exit         a whale sold 30%+ of their bag in one go (flagged when they've held 30+ days)
  dip          a whale bought a top token that's down 10%+ today
  rewards      whales of a reward token compounded their payouts (bought more) vs sold them
  dumping      3+ different whales sold the same token in 24 h
  board        a new #1 APY on the Stonk Board, or a token joining the board
  top10        a token breaking into stonkfun's top 10 by market cap
  payout       a stonkfun token paid its holders $2,500+ since the last run
  buy / pulse / milestone / link / tts   the stream's own alerts, recorded so the history matches what the stream
               showed: $MARINE buys $100+, $LINK buys $1,000+, payouts, milestones, $LINK ±5%/h, paid TTS
  score        a token's CLOBr score changed verdict or moved 10+ points (hour-delayed scores via the bot)
Also: lp = stonkfun tokens' Raydium + Meteora pools ranked by what liquidity earned in fees over 24 h (free APIs); lp1 the same
for the last hour. tx + tm: the last hour of whale trades, compact, for the trending page's 1H view.
"""
import base64, json, os, struct, sys, time, urllib.request

OUT = sys.argv[1] if len(sys.argv) > 1 else 'terminal'
BOT = 'https://war-room-bot.linkmarine777.workers.dev'
KEY = os.environ.get('HELIUS_KEY', '').strip()
URL = os.environ.get('SOLANA_RPC', '').strip()   # the same full RPC URL the bot uses (its Cloudflare secret), if copied here
RPC = URL or (f'https://mainnet.helius-rpc.com/?api-key={KEY}' if KEY else 'https://solana-rpc.publicnode.com')
KEY = KEY or URL   # below, KEY only means "a personal RPC is set"
RPC_IDX = RPC if KEY else 'https://api.mainnet-beta.solana.com'   # publicnode won't list a token's largest holders
SF = 'https://www.stonkfun.xyz/api/public/v1/tokens/'
MARINE = 'F8Sc8HoZvJcMrTY6vBsetTqGPv6XQmM2XgVAZo1sSTNK'
LINK = 'LinkhB3afbBKb2EQQu7s7umdZceV3wcvAUJhQAfQ23L'
MARINE_POOL = 'BnkYfw796XXq9UQ9kMYoX9iqSgXnjw7sFCsCVWVDiCUa'   # MARINE/LINK, where $MARINE trades (stonkfun's listed pool is empty)
LINK_POOLS = ['7YRKyGCHBJYAE2uyAGRDiz5WNq68FPzh2uDvDaYv1cNE', 'C4Nnrur8ZDVsdX4Y3vwaCFJXCHWRrS9LdRxV7wuU6Xrr']   # LINK/USDC, LINK/SOL
SOL = 'So11111111111111111111111111111111111111112'
STABLE = {'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'}   # USDC, USDT
BASE = STABLE | {SOL}
# pool / program authorities that show up as "holders" but never trade for themselves
NOT_WALLETS = {'5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1', 'GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL',
               'WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh', 'HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC'}
WHALES_PER_TOKEN, NEW_SIGS_MAX, TX_BUDGET, MIN_USD = 20, 12, 450, 25
now = int(time.time())
# FAST=1: the 2-minute pass between full runs: no RPC (holders, whale wallets, $MARINE holder count) and no LP scan; big
# trades, CLOBr scores, the board and the stream's alerts come out within minutes instead of batched every 30 min
FAST = os.environ.get('FAST') == '1'


def log(*a):
    out = [str(x) for x in a]
    for k in (KEY, URL): out = [x.replace(k, '***') for x in out] if k else out
    print(*out, flush=True)


def get(url, body=None, tries=4):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, json.dumps(body).encode() if body else None,
                                         {'Content-Type': 'application/json', 'User-Agent': 'war-room-whales'})
            with urllib.request.urlopen(req, timeout=30) as r: return json.load(r)
        except Exception as e:
            if i == tries - 1: raise
            time.sleep(2 * (i + 1) if '429' in str(e) else 1)


calls = 0
def rpc(method, params, url=None, tries=5):
    global calls
    for i in range(tries):
        calls += 1; time.sleep(0.12 if KEY else 0.25)
        try: r = get(url or RPC, {'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params}, tries=1)
        except Exception as e:
            if '429' not in str(e) or i == tries - 1: raise
            r = {'error': {'code': 429}}
        if 'error' not in r: return r['result']
        if r['error'].get('code') != 429 or i == tries - 1: raise RuntimeError(f"{method}: {r['error'].get('message')}")
        time.sleep(4 * (i + 1))   # the public node limits this call per IP; wait and retry


def load(name, default):
    try: return json.load(open(os.path.join(OUT, name)))
    except Exception: return default


def save(name, data):
    tmp = os.path.join(OUT, name + '.tmp')
    json.dump(data, open(tmp, 'w'), separators=(',', ':')); os.replace(tmp, os.path.join(OUT, name))


# ---------- who to watch ----------
toks = load('tokens.json', {}).get('tokens', [])
top = sorted([t for t in toks if t.get('mint') != MARINE], key=lambda t: -(t.get('mcap') or 0))[:10]
watch = [{'mint': MARINE, 'symbol': 'MARINE'}] + [{'mint': t['mint'], 'symbol': t.get('symbol'), 'chg24': t.get('chg24')} for t in top]
state = load('whales-state.json', {'last': {}, 'swaps': [], 'bots': [], 'holders': {}, 'first': {}})
quote, pools, pool_of = {}, set(), {}   # reward (quote) token per token; the tokens' own pools (never whales)
for t in watch:
    try:
        d = get(SF + t['mint'])['data']['token']
        quote[t['mint']] = (d.get('quote') or {}).get('mint'); pools.add(d.get('pool')); pool_of[t['mint']] = MARINE_POOL if t['mint'] == MARINE else d.get('pool')
    except Exception as e: log('stonkfun', t['symbol'], e)
H = state.setdefault('holders', {})
for t in watch:   # top holders straight from the chain, refreshed every 6 h
    h = H.get(t['mint'])
    if FAST or (h and now - h['at'] < 6 * 3600): continue
    try:
        accs = rpc('getTokenLargestAccounts', [t['mint']], RPC_IDX, tries=5 if KEY else 2)['value']
        info = rpc('getMultipleAccounts', [[a['address'] for a in accs], {'encoding': 'jsonParsed'}])['value']
        bal = {}
        for v in info:
            if not v: continue
            x = v['data']['parsed']['info']; bal[x['owner']] = bal.get(x['owner'], 0) + float(x['tokenAmount']['uiAmount'] or 0)
        H[t['mint']] = {'at': now, 'w': sorted(bal.items(), key=lambda kv: -kv[1])}
    except Exception as e: log('holders', t['symbol'], e)
whale = {}      # wallet -> [{mint, symbol, rank, balance, veteran}]
first = state.setdefault('first', {})   # when we first saw each wallet as a whale (how long they've held, from our side)
for t in watch:
    rank = 0
    for w, b in (H.get(t['mint']) or {}).get('w', []):
        if w in NOT_WALLETS or w in pools: continue
        rank += 1
        if rank > WHALES_PER_TOKEN: break
        first.setdefault(f"{w}:{t['mint']}", now)
        whale.setdefault(w, []).append({'mint': t['mint'], 'symbol': t['symbol'], 'rank': rank, 'balance': b,
                                        'veteran': now - first[f"{w}:{t['mint']}"] >= 30 * 86400})
log(f'watching {len(whale)} wallets across {len(watch)} tokens')
if not whale and not KEY: log('no holder lists: public nodes refuse getTokenLargestAccounts. Add the SOLANA_RPC (or HELIUS_KEY) repository secret (Settings -> Secrets and variables -> Actions).')

# ---------- new transactions per whale ----------
bots = set(state.get('bots', []))
raw = []        # (wallet, sig, time, {mint: delta})
budget = TX_BUDGET
for w in sorted(whale, key=lambda w: min(x['rank'] for x in whale[w])):
    if FAST or w in bots or budget <= 0: continue
    last = state['last'].get(w)
    try: sigs = rpc('getSignaturesForAddress', [w, {'limit': NEW_SIGS_MAX, **({'until': last} if last else {})}])
    except Exception as e: log('sigs', w[:6], e); continue
    if not sigs: continue
    state['last'][w] = sigs[0]['signature']
    fresh = [s for s in sigs if not s.get('err') and (last or now - (s.get('blockTime') or 0) < 86400)]
    if len(sigs) == NEW_SIGS_MAX and sigs[-1].get('blockTime', 0) > now - 1800:
        bots.add(w); log('skipping busy wallet (bot or pool)', w[:6]); continue
    for s in fresh[:budget]:
        budget -= 1
        try: tx = rpc('getTransaction', [s['signature'], {'encoding': 'jsonParsed', 'maxSupportedTransactionVersion': 0}])
        except Exception as e: log('tx', s['signature'][:8], e); continue
        if not tx or (tx.get('meta') or {}).get('err'): continue
        m = tx['meta']; keys = [k['pubkey'] for k in tx['transaction']['message']['accountKeys']]
        ch = {}
        for side, sgn in (('preTokenBalances', -1), ('postTokenBalances', 1)):
            for b in m.get(side) or []:
                if b.get('owner') == w:
                    ch[b['mint']] = ch.get(b['mint'], 0) + sgn * float((b.get('uiTokenAmount') or {}).get('uiAmountString') or 0)
        if w in keys:
            i = keys.index(w); sol = (m['postBalances'][i] - m['preBalances'][i] + (m.get('fee', 0) if i == 0 else 0)) / 1e9
            ch[SOL] = ch.get(SOL, 0) + sol
        ch = {k: v for k, v in ch.items() if abs(v) > 1e-9}
        if ch: raw.append((w, s['signature'], tx.get('blockTime') or now, ch))
log(f'{len(raw)} new transactions, {calls} RPC calls')

# ---------- the watched pools' latest trades (GeckoTerminal, free, no RPC), every pass incl. the 2-minute ones ----------
# Whales trading straight from their own wallet show up here within ~2 min, so whale alerts don't wait for the 30-min
# full pass (which reads each whale's own transactions over RPC and also catches trades a trading bot signed for them)
gt = {}
for t in watch:
    pool = pool_of.get(t['mint'])
    if not pool: continue
    try:
        time.sleep(2.5)   # GeckoTerminal allows ~30 calls a minute
        q = '' if pool == MARINE_POOL else '?trade_volume_in_usd_greater_than=100'
        rows = []
        for x in get(f'https://api.geckoterminal.com/api/v2/networks/solana/pools/{pool}/trades{q}').get('data') or []:
            a_ = x['attributes']; a_['ts'] = int(time.mktime(time.strptime(a_['block_timestamp'][:19], '%Y-%m-%dT%H:%M:%S'))) - time.timezone
            if a_['ts'] > now - 86400: rows.append(a_)
        gt[t['mint']] = rows
    except Exception as e: log('trades', t['symbol'], e)

# ---------- names + prices (Jupiter) ----------
meta = {}
mints = sorted({m for *_, ch in raw for m in ch} | {s[k]['m'] for s in state['swaps'] for k in ('buy', 'sell') if s.get(k)} | {t['mint'] for t in watch})
for i in range(0, len(mints), 50):
    try:
        for t in get('https://lite-api.jup.ag/tokens/v2/search?query=' + ','.join(mints[i:i + 50])):
            meta[t['id']] = {'s': t.get('symbol'), 'i': t.get('icon'), 'p': t.get('usdPrice') or 0}
    except Exception as e: log('jupiter', e)
sym = lambda m: (meta.get(m) or {}).get('s') or m[:4]

# ---------- $MARINE's real holder count: wallets holding a balance right now (stonkfun's holderCount is an all-time
# number: most of those wallets sold and left an empty token account behind) ----------
marine = load('whales.json', {}).get('marine')
try:
    assert not FAST, 'kept from the last full pass'
    prog = rpc('getAccountInfo', [MARINE, {'encoding': 'base64'}], RPC_IDX)['value']['owner']
    dec = rpc('getTokenSupply', [MARINE], RPC_IDX)['value']['decimals']
    accs = rpc('getProgramAccounts', [prog, {'encoding': 'base64', 'dataSlice': {'offset': 32, 'length': 40},
                                              'filters': [{'memcmp': {'offset': 0, 'bytes': MARINE}}]}], RPC_IDX)
    own = {}
    for a in accs:
        rb = base64.b64decode(a['account']['data'][0]); own[rb[:32]] = own.get(rb[:32], 0) + struct.unpack('<Q', rb[32:40])[0]
    held = [v / 10 ** dec for v in own.values() if v > 0]
    px = (meta.get(MARINE) or {}).get('p') or 0
    try: minusd = float(get(f'https://www.stonkfun.xyz/api/rewards?mint={MARINE}').get('minHoldingUsd') or 20)
    except Exception: minusd = 20
    marine = {'holders': len(held), 'eligible': sum(1 for v in held if v * px >= minusd) if px else None,
              'accounts': len(own), 'minUsd': minusd, 'at': now}
    log(f"$MARINE: {len(held)} holders, {marine['eligible']} with ${minusd:.0f}+, {len(own)} token accounts")
except Exception as e: log('marine holders', e)

# ---------- swaps ----------
seen = {s['sig'] for s in state['swaps']}
for w, sig, t, ch in raw:
    if sig in seen: continue
    usd = {m: v * (meta.get(m) or {}).get('p', 0) for m, v in ch.items()}
    ups = [m for m, u in usd.items() if u >= MIN_USD]; downs = [m for m, u in usd.items() if u <= -MIN_USD]
    if not ups: continue                       # sends / fees / dust
    b = max(ups, key=lambda m: usd[m]); s = min(downs, key=lambda m: usd[m]) if downs else None
    ev = {'sig': sig, 't': t, 'w': w, 'buy': {'m': b, 'a': ch[b], 'u': round(usd[b], 2)}}
    if s: ev['sell'] = {'m': s, 'a': -ch[s], 'u': round(-usd[s], 2)}
    else: ev['recv'] = True                    # tokens came in with nothing going out: a payout or a transfer
    state['swaps'].append(ev)
for mint, rows in gt.items():   # whale trades seen in the pools' trade lists (the other side is booked as SOL: a plain buy or sell)
    for a_ in rows:
        w, sig = a_.get('tx_from_address'), a_.get('tx_hash')
        if w not in whale or w in bots or not sig or sig in seen: continue
        u = float(a_.get('volume_in_usd') or 0)
        if u < MIN_USD: continue
        buy = a_.get('to_token_address') == mint
        amt = float((a_.get('to_token_amount') if buy else a_.get('from_token_amount')) or 0)
        side, other = {'m': mint, 'a': amt, 'u': round(u, 2)}, {'m': SOL, 'a': 0, 'u': round(u, 2)}
        state['swaps'].append({'sig': sig, 't': a_['ts'], 'w': w, 'buy': side if buy else other, 'sell': other if buy else side, 'gt': 1}); seen.add(sig)
state['swaps'] = sorted([s for s in state['swaps'] if s['t'] > now - 3 * 86400], key=lambda s: -s['t'])[:3000]
state['bots'] = sorted(bots)

# ---------- signals ----------
day = [s for s in state['swaps'] if s['t'] > now - 86400]
trades = [s for s in day if s.get('sell')]
top_mints = {t['mint']: t for t in watch}
label = lambda w: ' / '.join(f"#{x['rank']} ${x['symbol']}" for x in sorted(whale.get(w, []), key=lambda x: x['rank'])[:2]) or 'a'
signals = []
# once-a-day alerts fire at most once per rolling 24 h per token: they keep the id (and time) of their first firing, so
# the date changing at midnight UTC doesn't make every one of them look new and re-fire in one burst
DAILY = {'convergence', 'dumping', 'rewards', 'mover'}
fired = {k: v for k, v in state.setdefault('fired', {}).items() if now - v.get('seen', v['at']) < 2 * 86400}; state['fired'] = fired   # forgotten 2 days after it last qualified
def sig_(kind, key, t, text, mint=None, usd=0):
    if kind in DAILY:
        base = f"{kind}:{key.rsplit(':', 1)[0]}"; rec = fired.get(base)
        if rec: rec['seen'] = now
        # after 24 h it fires again only if the amount has at least doubled (real news): a plain 24 h expiry re-fired
        # everything from one burst together a day later (2026-09-30 00:40 UTC, ~30 at once)
        if rec and (now - rec['at'] < 86400 or usd < 2 * rec.setdefault('u', usd)): key, t = rec['key'], rec['t']
        else: fired[base] = {'at': now, 'key': key, 't': t, 'u': usd}
    signals.append({'id': f'{kind}:{key}', 'kind': kind, 't': t, 'text': text, 'm': mint, 's': sym(mint) if mint else None, 'i': (meta.get(mint) or {}).get('i'), 'u': round(usd)})

by = {}
for s in trades:
    m = s['buy']['m']
    if m in BASE: continue
    by.setdefault(m, []).append(s)
rewardq = set(quote.values())   # the reward tokens ($LINK, ...): whales swapping payouts is the 'rewards' alert, not buying or dumping
# piling in / dumping only for stonkfun coins themselves (the list + the Stonk Board): whales cashing out other coins' reward
# tokens ($HYPE, $ZEC, $wNEAR...) isn't news
stonk = {t['mint'] for t in toks} | set((load('board.json', {}).get('tokens') or {}).keys()) | {MARINE}
for m, L in by.items():
    ws = {s['w'] for s in L}
    if len(ws) >= 3 and m in stonk and m not in rewardq and sum(s['buy']['u'] for s in L) >= 1000:
        tot = sum(s['buy']['u'] for s in L)
        sig_('convergence', f"{m}:{time.strftime('%Y%m%d', time.gmtime(now))}", max(s['t'] for s in L),
             f"{len(ws)} whales bought ${sym(m)} today (${tot:,.0f})", m, tot)
sold = {}
for s in trades:
    if s['sell']['m'] not in BASE: sold.setdefault(s['sell']['m'], []).append(s)
for m, L in sold.items():
    ws = {s['w'] for s in L}
    if len(ws) >= 3 and m in stonk and m not in rewardq and sum(s['sell']['u'] for s in L) >= 1000:
        tot = sum(s['sell']['u'] for s in L)
        sig_('dumping', f"{m}:{time.strftime('%Y%m%d', time.gmtime(now))}", max(s['t'] for s in L),
             f"{len(ws)} whales sold ${sym(m)} today (${tot:,.0f})", m, tot)
for s in trades:
    if s['t'] < now - 3600: continue   # per-trade alerts only for the last hour (a token turning 'down today' later doesn't re-announce old buys)
    mine = {x['mint']: x for x in whale.get(s['w'], [])}
    sm, bm = s['sell']['m'], s['buy']['m']
    if sm in mine and bm not in BASE and bm != sm and s['sell']['u'] >= 500:
        sig_('rotation', s['sig'], s['t'], f"{label(s['w'])} whale rotated ${s['sell']['u']:,.0f} of ${sym(sm)} into ${sym(bm)}", bm, s['sell']['u'])
    if sm in mine and mine[sm]['balance'] and s['sell']['a'] >= 0.3 * (mine[sm]['balance'] + s['sell']['a']) and s['sell']['u'] >= 500:
        pct = s['sell']['a'] / (mine[sm]['balance'] + s['sell']['a']) * 100
        sig_('exit', s['sig'], s['t'], f"#{mine[sm]['rank']} ${sym(sm)} whale sold {pct:.0f}% of their bag (${s['sell']['u']:,.0f})", sm, s['sell']['u'])
    t = top_mints.get(bm)
    if t and (t.get('chg24') or 0) <= -10 and s['buy']['u'] >= 500:
        sig_('dip', s['sig'], s['t'], f"{label(s['w'])} whale bought the ${sym(bm)} dip · ${s['buy']['u']:,.0f} ({t['chg24']:.0f}% today)", bm, s['buy']['u'])
for tm, q in quote.items():   # rewards: whales of a reward token swapping their payout token
    comp = sell = 0
    for s in trades:
        if s['sell']['m'] == q and any(x['mint'] == tm for x in whale.get(s['w'], [])):
            if s['buy']['m'] == tm: comp += s['sell']['u']
            elif s['buy']['m'] in BASE: sell += s['sell']['u']
    if comp + sell >= 300:
        pc = comp / (comp + sell) * 100
        sig_('rewards', f"{tm}:{time.strftime('%Y%m%d', time.gmtime(now))}", now,
             (f"${sym(tm)} whales put {pc:.0f}% of their ${sym(q)} rewards back in today" if pc >= 20 else f"${sym(tm)} whales sold their ${sym(q)} rewards today (${sell:,.0f})"), tm, comp + sell)
# ---------- CLOBr score changes (the hour-delayed scores the trending page already shows) ----------
ranked = sorted(toks, key=lambda t: -(t.get('mcap') or 0))[:20]
names = {t['mint']: t.get('symbol') for t in toks}; names[MARINE] = 'MARINE'
try:
    sc = get(f"{BOT}/scores?mints=" + ','.join([MARINE] + [t['mint'] for t in ranked if t['mint'] != MARINE])).get('scores') or {}
    prev = state.setdefault('scores', {}); ch = []
    for m, x in sc.items():
        if x.get('score') is None: continue
        v, verdict = float(x['score']), str(x.get('msg') or '').split(':')[0].strip()
        p = prev.get(m)
        if p and (p['v'] != verdict or abs(v - p['s']) >= 10):
            if now - p.get('al', 0) < 3600: continue   # one alert per token per hour: keep the baseline, so a wobble back isn't news
            ch.append((abs(v - p['s']), m, int(x.get('at') or now * 1000), f"${names.get(m) or m[:4]} {p['s']:.0f} → {v:.0f} {'▲' if v > p['s'] else '▼'}"))
            prev[m] = {'s': v, 'v': verdict, 'al': now}; continue
        prev[m] = {'s': v, 'v': verdict, 'al': (p or {}).get('al', 0)}
    # CLOBr's delayed scores refresh for every token at once (hourly), so the changes come as one alert, not a burst of them
    ch.sort(key=lambda c: -c[0])
    if len(ch) == 1:
        _, m, at, txt = ch[0]; sig_('score', f"{m}:{at}", now, f"{txt.split(' ', 1)[0]} CLOBr {txt.split(' ', 1)[1]}", m, 0); signals[-1]['s'] = names.get(m) or signals[-1]['s']
        signals[-1]['i'] = 'mints:' + m   # the pages show CLOBr's logo, with each token linked to its terminal
    elif ch:
        m = ch[0][1]
        sig_('score', f"batch:{max(c[2] for c in ch)}", now, f"CLOBr: " + ' · '.join(c[3] for c in ch[:3]) + (f" · +{len(ch) - 3} more" if len(ch) > 3 else ''), m, 0)
        signals[-1]['s'] = names.get(m) or signals[-1]['s']
        signals[-1]['i'] = 'mints:' + ','.join(c[1] for c in ch[:3])
except Exception as e: log('scores', e)

# ---------- compound score changes (intel/compound.py's all-time scores, every 6 h: what the site shows) ----------
# as a 'rewards' alert (♻️ WHALE REWARDS: every page and the stream already show that kind): a token's score crossing a band
# (weak < 20 · mixed < 40 · healthy < 60 · strong) or moving 10+ points; only tokens whose tracked holders got $500+ of
# rewards since launch; a token seen for the first time is only remembered; at most 3 a pass (biggest change first, the rest
# wait for the next pass) and once a day per token
try:
    ci = load('compound/index.json', {}).get('tokens') or {}
    band = lambda v: 'Weak' if v < 20 else 'Mixed' if v < 40 else 'Healthy' if v < 60 else 'Strong'
    state.pop('compound', None); cprev = state.setdefault('compoundA', {}); cch = []   # all-time from now (7-day baseline dropped)
    for m, t in ci.items():
        v = (t.get('score') or {}).get('all'); ra = t.get('ra', t.get('r7'))
        if v is None or (ra is not None and ra < 500): continue
        p = cprev.get(m)
        if p is None: cprev[m] = v; continue
        if band(v) != band(p) or abs(v - p) >= 10: cch.append((abs(v - p), m, t, p, v))
    for _, m, t, p, v in sorted(cch, key=lambda c: -c[0])[:3]:
        sig_('rewards', f"compound:{m}:{t.get('at') or now}", now,
             f"${t.get('sym') or m[:4]} compound score {p:.0f} → {v:.0f} {'▲' if v > p else '▼'} ({band(p)} → {band(v)})"
             + (f" · {t['ca']:.0f}% of rewards put back since launch" if t.get('ca') is not None else ''), m, 0)
        cprev[m] = v
except Exception as e: log('compound alerts', e)

# ---------- big trades ($2,500+) on $MARINE + the top 10, and big movers (free: GeckoTerminal, stonkfun list) ----------
for t in watch:
    # every $2,500+ trade from the last 30 min, as it happens (the old 'top 3 of the day' re-announced trades hours late
    # whenever a bigger one aged out of the 24h window)
    big = [(float(a['volume_in_usd']), a['ts'], a) for a in gt.get(t['mint'], []) if float(a['volume_in_usd']) >= 2500 and a['ts'] > now - 1800]
    for u, ts, a in big:
        buy = a.get('to_token_address') == t['mint']
        sig_('bigtrade', a['tx_hash'], ts, f"{'Bought' if buy else 'Sold'} ${u:,.0f} of ${t['symbol']} · wallet {a.get('tx_from_address', '')[:4]}", t['mint'], u)
        signals[-1].update({'s': t['symbol'], 'side': 'buy' if buy else 'sell'})
for t in toks:
    c = t.get('chg24')
    if c is not None and abs(c) >= 20 and (t.get('vol24') or 0) >= 50000:
        sig_('mover', f"{t['mint']}:{time.strftime('%Y%m%d', time.gmtime(now))}", now,
             f"${t.get('symbol')} {'+' if c > 0 else ''}{c:.0f}% today · mc ${t.get('mcap') or 0:,.0f}", t['mint'], t.get('vol24') or 0)
        signals[-1].update({'s': t.get('symbol'), 'i': t.get('image'), 'side': 'up' if c > 0 else 'down'})

# ---------- market: new #1 APY, new on the Stonk Board, new stonkfun top 10, big holder payouts ----------
def pct_s(v):
    if v is None: return '?'
    if abs(v) >= 1e15: return '>1,000T%'
    for d, u in ((1e12, 'T'), (1e9, 'B'), (1e6, 'M'), (1e3, 'K')):
        if abs(v) >= d: return (f'{v / d:.1f}{u}%' if abs(v) < d * 1e3 or u != 'T' else f'{v:.1e}%')
    return f'{v:.0f}%'
bd = load('board.json', {}); btoks = bd.get('tokens') or {}; mk = state.setdefault('market', {})
# top 1 / new on the Stonk Board, top 10, holder payouts, $LINK ±5% and the LINK/payout milestones are recorded by the
# bot every few minutes now (same ids), so this job doesn't repeat them 30 min late

# ---------- the stream's own alerts, recorded (same rules as the terminal) ----------
st = state.setdefault('stream', {})
def gt_trades(pool, min_usd):
    # GeckoTerminal's size filter misses small pools like $MARINE's, so read the latest trades and filter here
    time.sleep(2.5)
    out = []
    q = '' if pool == MARINE_POOL else f'?trade_volume_in_usd_greater_than={min_usd}'
    for x in get(f'https://api.geckoterminal.com/api/v2/networks/solana/pools/{pool}/trades{q}').get('data') or []:
        a = x['attributes']
        if float(a.get('volume_in_usd') or 0) < min_usd: continue
        a['ts'] = int(time.mktime(time.strptime(a['block_timestamp'][:19], '%Y-%m-%dT%H:%M:%S'))) - time.timezone; out.append(a)
    return out
first_run = 'seen' not in st
seen_tx = set(st.get('seen', []))
try:   # $MARINE buys from $100, or $1,000 once its market cap is over $1M (same rule as the terminals)
    _p = get(f'https://api.dexscreener.com/latest/dex/pairs/solana/{MARINE_POOL}')['pairs'][0]; marine_min = 1000 if (_p.get('marketCap') or _p.get('fdv') or 0) > 1e6 else 100
except Exception: marine_min = 100
for mint, pools_, min_usd, symbol in ((MARINE, [MARINE_POOL], marine_min, 'MARINE'), (LINK, LINK_POOLS, 1000, 'LINK')):
    for pool in pools_:
        if not pool: continue
        try:
            for a in gt_trades(pool, min_usd):
                if a['tx_hash'] in seen_tx or a.get('to_token_address') != mint: continue
                seen_tx.add(a['tx_hash'])
                if a['ts'] < now - 86400: continue
                u = float(a['volume_in_usd']); amt = float(a.get('to_token_amount') or 0)
                sig_('buy', a['tx_hash'], a['ts'], f"{'🚨 Large ' if symbol == 'MARINE' and u >= 2500 else ''}${symbol} buy: ${u:,.0f} · {amt:,.0f} ${symbol} · wallet {a.get('tx_from_address', '')[:4]}" if amt >= 100 else
                     f"${symbol} buy: ${u:,.0f} · {amt:,.2f} ${symbol} · wallet {a.get('tx_from_address', '')[:4]}", mint, u)
                signals[-1].update({'s': symbol, 'side': 'buy'})
        except Exception as e: log('buys', symbol, e)
st['seen'] = list(seen_tx)[-3000:]
try:   # pulse (a $MARINE payout) + milestones, from stonkfun's live payout numbers
    r = get(f'https://www.stonkfun.xyz/api/rewards?mint={MARINE}')
    pv = st.get('rewards')
    if pv and r.get('lastPayoutAt') and r['lastPayoutAt'] != pv.get('lastPayoutAt') and (r.get('distributedTokens') or 0) > (pv.get('distributedTokens') or 0):
        tok = r['distributedTokens'] - pv['distributedTokens']; paid_to = (r.get('payoutCount') or 0) - (pv.get('payoutCount') or 0)
        ts = int(time.mktime(time.strptime(r['lastPayoutAt'][:19], '%Y-%m-%dT%H:%M:%S'))) - time.timezone
        sig_('pulse', f"pulse:{r['lastPayoutAt']}", ts, f"Pulse: {tok:,.2f} LINK (≈ ${tok * (r.get('quotePriceUsd') or 0):,.0f}) paid to {paid_to:,} $MARINE holders", MARINE, tok * (r.get('quotePriceUsd') or 0))
        signals[-1].update({'s': 'MARINE'})
    if pv:
        hold_now, hold_was = (marine or {}).get('holders'), st.get('holders')
        for key, cur, old, step, text in (('holders', hold_now, hold_was, 100, '{:,.0f} $MARINE holders'),):
            if cur and old and int(cur // step) > int(old // step):
                sig_('milestone', f"{key}:{int(cur // step) * step}", now, '🏆 ' + text.format(int(cur // step) * step), MARINE, 0)
                signals[-1].update({'s': 'MARINE'})
    load_ = (r.get('pendingUsd') or 0) / (r.get('minDistributionUsd') or 1)   # pulse incoming: next payout 90%+ loaded
    if load_ >= 0.9 and st.get('pulseWarned') != r.get('lastPayoutAt'):
        st['pulseWarned'] = r.get('lastPayoutAt')
        sig_('pulse', f"incoming:{r.get('lastPayoutAt')}", now, f"Pulse incoming: {min(load_, 1) * 100:.0f}% loaded · {r.get('pendingTokens') or 0:,.2f} LINK (≈ ${r.get('pendingUsd') or 0:,.0f}) about to hit $MARINE holders", MARINE, r.get('pendingUsd') or 0)
        signals[-1].update({'s': 'MARINE'})
    st['rewards'] = {k: r.get(k) for k in ('lastPayoutAt', 'distributedTokens', 'payoutCount')}
    st['holders'] = (marine or {}).get('holders') or st.get('holders')
except Exception as e: log('pulse', e)
mb = btoks.get(MARINE)   # $MARINE on the Stonk Board: enters or climbs 5+, APY up 1.5x
if mb:
    pr, pa = st.get('mrank'), st.get('mapy')
    if (pr is None and st.get('mseen')) or (pr and mb.get('rank') and pr - mb['rank'] >= 5):
        sig_('board', f"marine:{mb.get('rank')}:{now // 3600}", now, f"$MARINE {'enters the Stonk Board' if pr is None else 'climbs to'} #{mb.get('rank')}" + (f" (from #{pr})" if pr else ''), MARINE, 0)
        signals[-1].update({'s': 'MARINE'})
    if pa and mb.get('apy24h') and mb['apy24h'] >= 1.5 * pa:
        sig_('board', f"mapy:{now // 3600}", now, f"$MARINE APY jumps to {pct_s(mb['apy24h'])} (24h, modeled) from {pct_s(pa)}", MARINE, 0)
        signals[-1].update({'s': 'MARINE'})
    st['mrank'], st['mapy'] = mb.get('rank'), mb.get('apy24h')
else: st['mrank'] = None
st['mseen'] = True
try:   # whale watch: more of $MARINE's top-20 wallets buying this week (CLOBr's hour-delayed data the terminals already use)
    acc = ((((get(f"{BOT}/clobr?mint={MARINE}&d=1").get('whales') or {}).get('summary') or {}).get('accumulating') or {}).get('top20') or {}).get('7d')
    if acc is not None:
        if st.get('acc20') is not None and acc > st['acc20']:
            sig_('buy', f"whalewatch:{acc}:{now // 3600}", now, f"🐋 Whale watch: {acc - st['acc20']} more top-20 $MARINE wallet{'s' if acc - st['acc20'] > 1 else ''} buying · {acc} of the top 20 are buying this week", MARINE, 0)
            signals[-1].update({'s': 'MARINE', 'side': 'buy'})
        st['acc20'] = acc
except Exception as e: log('whale watch', e)
for x in (load('tts.json', {}).get('items') or [])[-30:]:   # paid TTS that played on the stream
    if x.get('at', 0) > now - 3 * 86400:
        sig_('tts', f"tts:{x['id']}", int(x['at']), f"📢 {x.get('from') or 'someone'}: “{str(x.get('text', ''))[:140]}”", None, 0)
movers_top = sorted(toks, key=lambda t: -(t.get('mcap') or 0))[:10]   # the terminal's rule: top 10 by market cap, ±20% in 24h
for t in movers_top:
    c = t.get('chg24')
    if c is not None and abs(c) >= 20 and (t.get('vol24') or 0) < 50000:
        sig_('mover', f"{t['mint']}:{time.strftime('%Y%m%d', time.gmtime(now))}", now, f"${t.get('symbol')} {'+' if c > 0 else ''}{c:.0f}% in 24h · mc ${t.get('mcap') or 0:,.0f}", t['mint'], 0)
        signals[-1].update({'s': t.get('symbol'), 'i': t.get('image'), 'side': 'up' if c > 0 else 'down'})

# ---------- LP: which stonkfun pools earned the most fees per $ of liquidity in 24 h ----------
lp = []
board = load('board.json', {}).get('tokens', {})
every = {t['mint']: t for t in toks}
for m, b in board.items(): every.setdefault(m, {'mint': m, 'symbol': b.get('symbol'), 'image': b.get('image')})
for t in ([] if FAST else every.values()):
    m = t['mint']
    time.sleep(0.3)
    try:
        for p in get(f'https://api-v3.raydium.io/pools/info/mint?mint1={m}&poolType=all&poolSortField=default&sortType=desc&pageSize=5&page=1')['data']['data']:
            tvl, fee = p.get('tvl') or 0, (p.get('day') or {}).get('volumeFee') or 0
            if tvl >= 5000 and fee > 0:
                lp.append({'m': m, 's': t.get('symbol'), 'i': t.get('image'), 'pair': f"{p['mintA']['symbol']}/{p['mintB']['symbol']}".replace('WSOL', 'SOL'),
                           'dex': 'Raydium ' + ('CLMM' if p.get('type') == 'Concentrated' else 'AMM'), 'tvl': round(tvl), 'fee': round(fee), 'd': round(fee / tvl * 100, 2),
                           'url': f"https://raydium.io/liquidity/increase/?mode=add&pool_id={p['id']}", 'id': p['id'], 'rate': p.get('feeRate') or 0})
    except Exception as e: log('raydium', t.get('symbol'), e)
    try:
        for p in get(f'https://dlmm.datapi.meteora.ag/pools?query={m}&page_size=5').get('data') or []:
            tvl, fee = p.get('tvl') or 0, (p.get('fees') or {}).get('24h') or 0
            if tvl >= 5000 and fee > 0 and not p.get('is_blacklisted'):
                f1 = (p.get('fees') or {}).get('1h') or 0
                lp.append({'m': m, 's': t.get('symbol'), 'i': t.get('image'), 'pair': (p.get('name') or '').replace('-', '/'), 'dex': 'Meteora DLMM',
                           'tvl': round(tvl), 'fee': round(fee), 'd': round(fee / tvl * 100, 2), 'url': f"https://app.meteora.ag/dlmm/{p['address']}",
                           'fee1': round(f1), 'd1': round(f1 / tvl * 100, 3)})
    except Exception as e: log('meteora', t.get('symbol'), e)
# last hour (the trending page's 1H switch): Meteora reports it; Raydium only has the day, so its pools' last-hour volume
# (DexScreener, 30 pools per call) x the pool's fee rate
ray = [x for x in lp if 'id' in x]
for i in range(0, len(ray), 30):
    try:
        vol = {p['pairAddress']: (p.get('volume') or {}).get('h1') or 0
               for p in get('https://api.dexscreener.com/latest/dex/pairs/solana/' + ','.join(x['id'] for x in ray[i:i + 30])).get('pairs') or []}
        for x in ray[i:i + 30]:
            if x['id'] in vol: f1 = vol[x['id']] * x['rate']; x['fee1'], x['d1'] = round(f1), round(f1 / x['tvl'] * 100, 3)
    except Exception as e: log('dexscreener lp', e)
for x in lp: x.pop('id', None); x.pop('rate', None)
if FAST: lp, lp1 = load('whales.json', {}).get('lp', []), load('whales.json', {}).get('lp1', [])
else: lp, lp1 = sorted(lp, key=lambda x: -x['d'])[:20], sorted([x for x in lp if x.get('fee1')], key=lambda x: -x['d1'])[:20]

old = {s['id']: s['t'] for s in load('whales.json', {}).get('signals', [])}
for s in signals: s['t'] = old.get(s['id'], s['t'])            # a signal keeps the time it first fired
for s in load('whales.json', {}).get('signals', []):   # history: signals from earlier runs stay for 3 days
    if s['id'] not in {x['id'] for x in signals} and s['t'] > now - 3 * 86400: signals.append(s)
signals = sorted(signals, key=lambda s: -s['t'])[:250]
# one-time backfill: past alerts rebuilt from the data history (intel/alerts-backfill.json) ride along in this run's file
# so the bot copies them into the database; later runs go back to the normal 3 days / 250
bf_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'alerts-backfill.json')
if os.path.exists(bf_path):
    bf = json.load(open(bf_path)); tag = f"{len(bf)}:{bf[0]['id'] if bf else ''}"
    if state.get('backfilled') != tag:
        have = {x['id'] for x in signals}
        signals = sorted(signals + [x for x in bf if x['id'] not in have], key=lambda s: -s['t'])
        state['backfilled'] = tag; log(f'backfill: {len(bf)} past alerts included for the database')

# ---------- what whales are buying / selling (24 h; the page builds the last hour from tx below) ----------
def whale_flow(L):
    flow = {}
    for s in L:
        for side, sign in (('buy', 1), ('sell', -1)):
            m = s[side]['m']
            if m in BASE: continue
            f = flow.setdefault(m, {'m': m, 's': sym(m), 'i': (meta.get(m) or {}).get('i'), 'p': (meta.get(m) or {}).get('p'),
                                     'top': m in top_mints, 'b': 0, 'x': 0, 'buyers': set(), 'sellers': set()})
            f['b' if sign > 0 else 'x'] += s[side]['u']; f['buyers' if sign > 0 else 'sellers'].add(s['w'])
    rows = [{**f, 'b': round(f['b']), 'x': round(f['x']), 'net': round(f['b'] - f['x']), 'buyers': len(f['buyers']), 'sellers': len(f['sellers'])} for f in flow.values()]
    return (sorted([r for r in rows if r['net'] > 0], key=lambda r: (-r['buyers'], -r['net']))[:15],
            sorted([r for r in rows if r['net'] < 0], key=lambda r: (-r['sellers'], r['net']))[:15])
buying, selling = whale_flow(trades)
# the whale trades of the last hour, compact, so the trending page builds its 1H view itself:
# tx = [time, wallet, buy mint #, buy $, sell mint #, sell $], tm = [mint, symbol, icon, 1 if SOL/USDC/USDT]
tm, tmi = [], {}
def mi(m):
    if m not in tmi: tmi[m] = len(tm); tm.append([m, sym(m), (meta.get(m) or {}).get('i'), 1 if m in BASE else 0])
    return tmi[m]
tx = [[s['t'], s['w'][:6], mi(s['buy']['m']), round(s['buy']['u']), mi(s['sell']['m']), round(s['sell']['u'])] for s in trades if s['t'] > now - 3600]
recent = [{'t': s['t'], 'w': s['w'][:4], 'who': label(s['w']), 'buy': sym(s['buy']['m']), 'bi': (meta.get(s['buy']['m']) or {}).get('i'),
           'sell': sym(s['sell']['m']), 'u': round(max(s['buy']['u'], s['sell']['u'])), 'sig': s['sig']} for s in trades[:60]]
save('whales.json', {
    'at': now, 'wallets': len(whale), 'tokens': ['$' + t['symbol'] for t in watch],
    'buying': buying, 'selling': selling, 'tx': tx, 'tm': tm,
    'signals': signals, 'recent': recent, 'lp': lp, 'lp1': lp1, 'marine': marine})
save('whales-state.json', state)

# ---------- the $MARINE chart (chart.json): GeckoTerminal answers GitHub's runners, while the bot's copy from Cloudflare's
# shared addresses keeps getting rate-limited. Same format as the bot's: 1d (15m closes), 7d (hourly), all (4h), [t, marine $, LINK $]
def ohlcv(tf, agg, side):
    time.sleep(2.5)
    return get(f'https://api.geckoterminal.com/api/v2/networks/solana/pools/{MARINE_POOL}/ohlcv/{tf}?aggregate={agg}&limit=1000&currency=usd&token={side}')
def series(tf, agg):
    b, q = ohlcv(tf, agg, 'base'), ohlcv(tf, agg, 'quote')
    tok, other = (b, q) if b['meta']['base']['address'] == MARINE else (q, b)
    o = {r[0]: r[4] for r in other['data']['attributes']['ohlcv_list']}
    return sorted([r[0], r[4], o[r[0]]] for r in tok['data']['attributes']['ohlcv_list'] if r[0] in o)
try:
    assert not FAST or now // 120 % 5 == 0, 'chart every ~10 min in the fast passes'
    m15, h4 = series('minute', 15), series('hour', 4)
    if m15:
        hourly = {}
        for r in m15: hourly[r[0] // 3600 * 3600] = [r[0] // 3600 * 3600, r[1], r[2]]   # last close in each hour
        save('chart.json', {'1d': m15[-96:], '7d': list(hourly.values())[-168:], 'all': h4, 'at': int(time.time())})
        log(f'chart: {len(m15)} 15m, {len(h4)} 4h candles')
except Exception as e: log('chart', e)
log(f"done{' (fast pass)' if FAST else ''}: {len(trades)} whale swaps in 24h, {len(signals)} signals, {calls} RPC calls, rpc={'helius' if KEY else 'public'}")
