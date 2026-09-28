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
"""
import json, os, sys, time, urllib.request

OUT = sys.argv[1] if len(sys.argv) > 1 else 'terminal'
BOT = 'https://war-room-bot.linkmarine777.workers.dev'
KEY = os.environ.get('HELIUS_KEY', '').strip()
RPC = f'https://mainnet.helius-rpc.com/?api-key={KEY}' if KEY else 'https://solana-rpc.publicnode.com'
RPC_IDX = RPC if KEY else 'https://api.mainnet-beta.solana.com'   # publicnode won't list a token's largest holders
SF = 'https://www.stonkfun.xyz/api/public/v1/tokens/'
MARINE = 'F8Sc8HoZvJcMrTY6vBsetTqGPv6XQmM2XgVAZo1sSTNK'
SOL = 'So11111111111111111111111111111111111111112'
STABLE = {'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'}   # USDC, USDT
BASE = STABLE | {SOL}
# pool / program authorities that show up as "holders" but never trade for themselves
NOT_WALLETS = {'5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1', 'GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL',
               'WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh', 'HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC'}
WHALES_PER_TOKEN, NEW_SIGS_MAX, TX_BUDGET, MIN_USD = 20, 12, 450, 25
now = int(time.time())


def log(*a): print(*[str(x).replace(KEY, '***') if KEY else x for x in a], flush=True)


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
quote, pools = {}, set()   # token mint -> its reward (quote) token; the tokens' own pools (never whales)
for t in watch:
    try:
        d = get(SF + t['mint'])['data']['token']
        quote[t['mint']] = (d.get('quote') or {}).get('mint'); pools.add(d.get('pool'))
    except Exception as e: log('stonkfun', t['symbol'], e)
H = state.setdefault('holders', {})
for t in watch:   # top holders straight from the chain, refreshed every 6 h
    h = H.get(t['mint'])
    if h and now - h['at'] < 6 * 3600: continue
    try:
        accs = rpc('getTokenLargestAccounts', [t['mint']], RPC_IDX)['value']
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

# ---------- new transactions per whale ----------
bots = set(state.get('bots', []))
raw = []        # (wallet, sig, time, {mint: delta})
budget = TX_BUDGET
for w in sorted(whale, key=lambda w: min(x['rank'] for x in whale[w])):
    if w in bots or budget <= 0: continue
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

# ---------- names + prices (Jupiter) ----------
meta = {}
mints = sorted({m for *_, ch in raw for m in ch} | {s[k]['m'] for s in state['swaps'] for k in ('buy', 'sell') if s.get(k)} | {t['mint'] for t in watch})
for i in range(0, len(mints), 50):
    try:
        for t in get('https://lite-api.jup.ag/tokens/v2/search?query=' + ','.join(mints[i:i + 50])):
            meta[t['id']] = {'s': t.get('symbol'), 'i': t.get('icon'), 'p': t.get('usdPrice') or 0}
    except Exception as e: log('jupiter', e)
sym = lambda m: (meta.get(m) or {}).get('s') or m[:4]

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
state['swaps'] = sorted([s for s in state['swaps'] if s['t'] > now - 3 * 86400], key=lambda s: -s['t'])[:3000]
state['bots'] = sorted(bots)

# ---------- signals ----------
day = [s for s in state['swaps'] if s['t'] > now - 86400]
trades = [s for s in day if s.get('sell')]
top_mints = {t['mint']: t for t in watch}
label = lambda w: ' / '.join(f"#{x['rank']} ${x['symbol']}" for x in sorted(whale.get(w, []), key=lambda x: x['rank'])[:2]) or 'a whale'
signals = []
def sig_(kind, key, t, text, mint=None, usd=0):
    signals.append({'id': f'{kind}:{key}', 'kind': kind, 't': t, 'text': text, 'm': mint, 's': sym(mint) if mint else None, 'i': (meta.get(mint) or {}).get('i'), 'u': round(usd)})

by = {}
for s in trades:
    m = s['buy']['m']
    if m in BASE: continue
    by.setdefault(m, []).append(s)
for m, L in by.items():
    ws = {s['w'] for s in L}
    if len(ws) >= 3:
        tot = sum(s['buy']['u'] for s in L); groups = sorted({x['symbol'] for w in ws for x in whale.get(w, [])})
        sig_('convergence', f"{m}:{time.strftime('%Y%m%d', time.gmtime(now))}", max(s['t'] for s in L),
             f"{len(ws)} whales bought ${sym(m)} in the last 24h (${tot:,.0f}) · whales of " + ', '.join('$' + g for g in groups[:4]), m, tot)
for s in trades:
    mine = {x['mint']: x for x in whale.get(s['w'], [])}
    sm, bm = s['sell']['m'], s['buy']['m']
    if sm in mine and bm not in BASE and bm != sm and s['sell']['u'] >= 500:
        sig_('rotation', s['sig'], s['t'], f"{label(s['w'])} whale rotated ${s['sell']['u']:,.0f} of ${sym(sm)} into ${sym(bm)}", bm, s['sell']['u'])
    if sm in mine and mine[sm]['balance'] and s['sell']['a'] >= 0.3 * (mine[sm]['balance'] + s['sell']['a']) and s['sell']['u'] >= 500:
        pct = s['sell']['a'] / (mine[sm]['balance'] + s['sell']['a']) * 100
        sig_('exit', s['sig'], s['t'], f"#{mine[sm]['rank']} ${sym(sm)} whale sold {pct:.0f}% of their bag (${s['sell']['u']:,.0f})"
             + (' · held 30+ days' if mine[sm]['veteran'] else ''), sm, s['sell']['u'])
    t = top_mints.get(bm)
    if t and (t.get('chg24') or 0) <= -10 and s['buy']['u'] >= 500:
        sig_('dip', s['sig'], s['t'], f"{label(s['w'])} whale bought the dip on ${sym(bm)} ({t['chg24']:.0f}% today) · ${s['buy']['u']:,.0f}", bm, s['buy']['u'])
for tm, q in quote.items():   # rewards: whales of a reward token swapping their payout token
    comp = sell = 0
    for s in trades:
        if s['sell']['m'] == q and any(x['mint'] == tm for x in whale.get(s['w'], [])):
            if s['buy']['m'] == tm: comp += s['sell']['u']
            elif s['buy']['m'] in BASE: sell += s['sell']['u']
    if comp + sell >= 300:
        pc = comp / (comp + sell) * 100
        sig_('rewards', f"{tm}:{time.strftime('%Y%m%d', time.gmtime(now))}", now,
             f"${sym(tm)} whales compounded {pc:.0f}% of their ${sym(q)} rewards today (${comp:,.0f} back in, ${sell:,.0f} sold)", tm, comp + sell)
old = {s['id']: s['t'] for s in load('whales.json', {}).get('signals', [])}
for s in signals: s['t'] = old.get(s['id'], s['t'])            # a signal keeps the time it first fired
signals = sorted(signals, key=lambda s: -s['t'])[:40]

# ---------- what whales are buying / selling (24 h) ----------
flow = {}
for s in trades:
    for side, sign in (('buy', 1), ('sell', -1)):
        m = s[side]['m']
        if m in BASE: continue
        f = flow.setdefault(m, {'m': m, 's': sym(m), 'i': (meta.get(m) or {}).get('i'), 'p': (meta.get(m) or {}).get('p'),
                                 'top': m in top_mints, 'b': 0, 'x': 0, 'buyers': set(), 'sellers': set()})
        f['b' if sign > 0 else 'x'] += s[side]['u']; f['buyers' if sign > 0 else 'sellers'].add(s['w'])
rows = [{**f, 'b': round(f['b']), 'x': round(f['x']), 'net': round(f['b'] - f['x']), 'buyers': len(f['buyers']), 'sellers': len(f['sellers'])} for f in flow.values()]
recent = [{'t': s['t'], 'w': s['w'][:4], 'who': label(s['w']), 'buy': sym(s['buy']['m']), 'bi': (meta.get(s['buy']['m']) or {}).get('i'),
           'sell': sym(s['sell']['m']), 'u': round(max(s['buy']['u'], s['sell']['u'])), 'sig': s['sig']} for s in trades[:60]]
save('whales.json', {
    'at': now, 'wallets': len(whale), 'tokens': ['$' + t['symbol'] for t in watch],
    'buying': sorted([r for r in rows if r['net'] > 0], key=lambda r: (-r['buyers'], -r['net']))[:15],
    'selling': sorted([r for r in rows if r['net'] < 0], key=lambda r: (-r['sellers'], r['net']))[:15],
    'signals': signals, 'recent': recent})
save('whales-state.json', state)
log(f"done: {len(trades)} whale swaps in 24h, {len(signals)} signals, {calls} RPC calls, rpc={'helius' if KEY else 'public'}")
