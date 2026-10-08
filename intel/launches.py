#!/usr/bin/env python3
"""Launch radar: what's about to be listed on stonkfun, what just was, and which new launches are real.

Runs on GitHub Actions (.github/workflows/launches.yml, a pass every ~5 min) and writes into the data branch:
  terminal/launches.json        what /launches/ reads (and the whale radar folds its signals into the shared alerts)
  terminal/launches-state.json  memory between passes: pairs and verified tokens seen, VRFD submissions, launches, dev records

The listing pipeline, each step from a public source:
  1. VRFD   an issuer pays Jupiter's verification desk 1,000 JUP (to VRFD_FEE, co-signed by VRFD's fee payer). Sunrise
            (LISTERS) does this for each stock it brings to Solana, and stonkfun lists those as pairs soon after.
  2. verified  Jupiter's verified list gains a stock / RWA token from an issuer stonkfun lists, not a stonkfun pair yet
  3. newpair   stonkfun's pair list (/api/public/v1/pairs) gains a quote token: coins can launch against it now
  4. launch    a launch from the last 24 h scores REAL (below), the first time it does

The REAL score (0-100) of each launch from the last 24 h that trades ($2,500+ volume or graduated):
  organic buyers 30  Jupiter's count of distinct organic buyers in 24 h (bots and wash wallets filtered out by Jupiter)
  fee-backed     20  what the coin actually paid its holders, divided by its tax rate, against the volume it reports.
                     A taxed trade always pays: real volume comes out near 1.0, volume that skips the tax or is
                     washed through untaxed routes comes out far below it (farms measured at 0.2-0.35, real coins 0.6-1.5)
  holders        15  Jupiter's holder count
  spread         10  the top holders' share of the supply (less is better)
  dev            15  the deployer's record across every launch seen (back 14 days): 1 in 5 of their other coins
                     graduated or one peaked at $500k+ = 15, a serial launcher (5+ coins, under 1 in 10 graduated) = 0
  organic vol    10  Jupiter's organic share of the volume
REAL 60+, WATCH 35+, FARM = $20,000+ volume that the fees or organic buyers don't back up, THIN otherwise.
Everything here is free: stonkfun's public API, Jupiter's token API, a few Solana RPC calls a pass.
"""
import calendar, json, math, os, sys, time, urllib.request

OUT = sys.argv[1] if len(sys.argv) > 1 else 'terminal'
SF = 'https://www.stonkfun.xyz'
JUP = 'https://lite-api.jup.ag/tokens/v2'
KEY = os.environ.get('HELIUS_KEY', '').strip()
URL = os.environ.get('SOLANA_RPC', '').strip()
RPC = URL or (f'https://mainnet.helius-rpc.com/?api-key={KEY}' if KEY else 'https://api.mainnet-beta.solana.com')
VRFD_FEE = 'H9at42xAafMAYqWmL4sxX5EiUpECruvEsdsBc6uDJUtT'   # Jupiter VRFD's JUP account: every paid submission lands here
LISTERS = {'EMUCNjWt8AUQXUEjUnCDqqjDqLb63Trios1TnoUPvoJN': 'Sunrise'}   # issuers whose submissions become stonkfun pairs
STOCKY = {'stocks', 'rwa', 'xstocks', 'backpack', 'prestocks', 'equities'}   # Jupiter tags of the assets stonkfun pairs with
WINDOW, BF_DAYS, BF_PAGES = 86400, 14, 25   # launches scored for 24 h; dev records from the last 14 days, 25 older pages a pass
now = int(time.time())
FULL = os.environ.get('FULL') == '1'


def log(*a):
    out = [str(x) for x in a]
    for k in (KEY, URL): out = [x.replace(k, '***') for x in out] if k else out
    print(*out, flush=True)


def get(url, body=None, tries=4):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, json.dumps(body).encode() if body else None,
                                         {'Content-Type': 'application/json', 'User-Agent': 'war-room-launches'})
            with urllib.request.urlopen(req, timeout=40) as r: return json.load(r)
        except Exception as e:
            if i == tries - 1: raise
            time.sleep(2 * (i + 1) if '429' in str(e) else 1)


def rpc(method, params):
    for i in range(5):
        time.sleep(0.15 if URL or KEY else 0.5)
        r = get(RPC, {'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params}, tries=2)
        if 'error' not in r: return r['result']
        if r['error'].get('code') != 429 or i == 4: raise RuntimeError(f"{method}: {r['error'].get('message')}")
        time.sleep(4 * (i + 1))


def load(name, default):
    try: return json.load(open(os.path.join(OUT, name)))
    except Exception: return default


def save(name, data):
    tmp = os.path.join(OUT, name + '.tmp')
    json.dump(data, open(tmp, 'w'), separators=(',', ':')); os.replace(tmp, os.path.join(OUT, name))


def ts(iso):
    try: return calendar.timegm(time.strptime((iso or '')[:19], '%Y-%m-%dT%H:%M:%S'))
    except Exception: return 0


def img(u): return (SF + u) if u and u.startswith('/') else u


def jup(mints):
    """Jupiter's token data for many mints (50 a call)."""
    out = {}
    for i in range(0, len(mints), 50):
        try:
            for x in get(f'{JUP}/search?query=' + ','.join(mints[i:i + 50])) or []: out[x['id']] = x
        except Exception as e: log('jupiter', e)
        time.sleep(0.25)
    return out


state = load('launches-state.json', {})
for k, v in (('pairs', {}), ('verified', {}), ('vrfd', []), ('subs', {}), ('live', {}), ('devs', {}), ('rw', {}), ('fired', {})):
    state.setdefault(k, v)
FULL = FULL or now - state.get('fullAt', 0) > 1800   # Jupiter's verified list and the dev backfill: every 30 min
signals = []
def sig(kind, key, text, mint=None, sym=None, image=None, usd=0, side=None):
    signals.append({'id': f'{kind}:{key}', 'kind': kind, 't': now, 'text': text, 'm': mint, 's': sym, 'i': image, 'u': round(usd or 0), 'side': side})

# ---------- 3. stonkfun's pairs: a quote token appearing is a new pair ----------
pairs = {}
try: pairs = {p['mint']: p for p in get(f'{SF}/api/public/v1/pairs')['data']['pairs']}
except Exception as e: log('pairs', e)
first_pairs = not state['pairs']
if pairs and len(pairs) >= len(state['pairs']) / 2:   # a list far shorter than the last (a broken answer) changes nothing
    for m, p in pairs.items():
        if m in state['pairs']: continue
        state['pairs'][m] = 0 if first_pairs else now   # the first pass only records what's there (0 = before the radar)
        if not first_pairs:
            sig('newpair', m, f"stonkfun added ${p['symbol']} ({p.get('categoryLabel') or p.get('category')}) as a pair: coins can launch against it now",
                m, p['symbol'], img(p.get('logoUrl')))
            log('new pair', p['symbol'])
cat_of = {m: p.get('categoryLabel') or p.get('category') for m, p in pairs.items()}

# ---------- 1. VRFD submissions (1,000 JUP each) ----------
try:
    sigs = rpc('getSignaturesForAddress', [VRFD_FEE, {'limit': 25, **({'until': state['vrfdLast']} if state.get('vrfdLast') else {})}])
    first_vrfd = not state.get('vrfdLast')
    for s in reversed(sigs or []):   # oldest first; one that can't be read now stops here and is read next pass
        if not s.get('err'):
            try: tx = rpc('getTransaction', [s['signature'], {'encoding': 'jsonParsed', 'maxSupportedTransactionVersion': 1}])
            except Exception as e: log('vrfd tx', s['signature'][:8], e); break
        state['vrfdLast'] = s['signature']
        if s.get('err'): continue
        for ix in ((tx or {}).get('transaction') or {}).get('message', {}).get('instructions', []):
            p = ix.get('parsed') or {}
            if p.get('type') not in ('transfer', 'transferChecked') or (p.get('info') or {}).get('destination') != VRFD_FEE: continue
            by = p['info'].get('authority') or p['info'].get('source')
            amt = float((p['info'].get('tokenAmount') or {}).get('uiAmountString') or 0) or int(p['info'].get('amount') or 0) / 1e6
            state['subs'][by] = state['subs'].get(by, 0) + 1
            state['vrfd'].append({'sig': s['signature'], 't': tx.get('blockTime') or now, 'by': by, 'who': LISTERS.get(by), 'jup': amt})
            if by in LISTERS and not first_vrfd:
                sig('vrfd', s['signature'], f"{LISTERS[by]} just paid Jupiter VRFD to verify a new token: its last listings became stonkfun pairs",
                    None, LISTERS[by], None, 0)
                log('vrfd submission by', LISTERS[by])
    state['vrfd'] = state['vrfd'][-60:]
except Exception as e: log('vrfd', e)

# ---------- 2. verified by Jupiter, not a stonkfun pair yet (every 30 min) ----------
pending = load('launches.json', {}).get('pending', [])
if FULL:
    try:
        V = get(f'{JUP}/tag?query=verified')
        stocky = {x['id']: x for x in V if STOCKY & set(x.get('tags') or [])}
        # the issuers stonkfun lists: deployers of tokens that are pairs already, named after their stonkfun category
        issuer = {}
        for m, x in stocky.items():
            if m in pairs and x.get('dev'): issuer.setdefault(x['dev'], cat_of.get(m))
        first_ver = not state['verified']
        out = []
        for m, x in stocky.items():
            if m in pairs or x.get('dev') not in issuer: continue
            seen = state['verified'].setdefault(m, 0 if first_ver else now)
            liq = x.get('liquidity') or 0; st = x.get('stats24h') or {}
            row = {'m': m, 's': x.get('symbol'), 'n': x.get('name'), 'i': x.get('icon'), 'who': issuer[x['dev']], 'liq': round(liq),
                   'h': x.get('holderCount') or 0, 'v': round((st.get('buyVolume') or 0) + (st.get('sellVolume') or 0)),
                   'c': ts(x.get('createdAt')), 'seen': seen}
            out.append(row)
            if seen == now and (liq >= 5000 or issuer[x['dev']] == 'Sunrise'):
                sig('verified', m, f"Jupiter verified ${x.get('symbol')} ({issuer[x['dev']]}): not a stonkfun pair yet, {issuer[x['dev']]}'s last ones were listed",
                    m, x.get('symbol'), x.get('icon'), liq)
        # newest verified first, then the most liquid: the likeliest next pairs
        pending = sorted(out, key=lambda r: (-r['seen'], -r['liq'], -r['c']))[:60]
    except Exception as e: log('verified', e)

# ---------- 4. the last 24 h of launches ----------
feed, page = [], 1
while page <= 25:
    try: L = get(f'{SF}/api/public/v1/tokens?sort=newest&pageSize=100&page={page}')['data']['tokens']
    except Exception as e: log('newest', page, e); break
    feed += L
    if not L or ts(L[-1].get('createdAt')) < now - WINDOW: break
    page += 1; time.sleep(0.3)
feed = [t for t in feed if ts(t.get('createdAt')) >= now - WINDOW]
log(f'{len(feed)} launches in 24 h ({page} pages)')
first_live = not state['live'] and not state['devs']
if feed:
    by_mint = {t['mint']: t for t in feed}
    # a launch leaving the window goes into its dev's record with how it did
    def record(dev, peak, grad):
        d = state['devs'].setdefault(dev, [0, 0, 0, 0])   # launches, graduated, best peak $, last launch time
        d[0] += 1; d[1] += 1 if grad else 0; d[2] = max(d[2], round(peak or 0))
    for m in [m for m, x in state['live'].items() if x['c'] < now - WINDOW]:
        x = state['live'].pop(m)
        if x.get('dev'): record(x['dev'], x.get('pk'), x.get('g'))
        state['rw'].pop(m, None); state['fired'].pop(m, None)
    # who deployed the new ones (Jupiter's dev field: stonkfun's newest list doesn't name the creator)
    new = [m for m in by_mint if m not in state['live']]
    J = jup(new)
    for m in new:
        t = by_mint[m]
        state['live'][m] = {'c': ts(t['createdAt']), 'dev': (J.get(m) or {}).get('dev')}
    for m, t in by_mint.items():
        x = state['live'][m]; mk = t.get('market') or {}
        x.update({'pk': mk.get('peakMarketCapUsd') or 0, 'g': t.get('status') == 'graduated'})

    # the ones that trade: Jupiter's organic numbers + stonkfun's payouts (cached 15 min a coin)
    cand = sorted([t for t in feed if ((t.get('market') or {}).get('volume24hUsd') or 0) >= 2500 or t.get('status') == 'graduated'],
                  key=lambda t: -((t.get('market') or {}).get('volume24hUsd') or 0))[:400]
    JC = jup([t['mint'] for t in cand])
    looked = 0
    for t in cand[:150]:
        if t.get('mode') != 'reward': continue
        r = state['rw'].get(t['mint'])
        if r and now - r[3] < 900: continue
        if looked >= 80: break
        looked += 1; time.sleep(0.2)
        try:
            d = get(f"{SF}/api/rewards?mint={t['mint']}")
            state['rw'][t['mint']] = [round((d.get('distributedUsd') or 0) + (d.get('pendingUsd') or 0) + (d.get('pendingTaxUsd') or 0), 2),
                                      d.get('transferTaxBps') or 0, d.get('holderCount') or 0, now]
        except Exception as e: log('rewards', t['symbol'], e)

    def dev_rec(dev, mint):
        """The dev's other launches: how many, how many graduated, the best peak (this coin left out)."""
        d = state['devs'].get(dev or '')
        live = [x for k, x in state['live'].items() if x.get('dev') == dev and k != mint] if dev else []
        n = (d[0] if d else 0) + len(live); g = (d[1] if d else 0) + sum(1 for x in live if x.get('g'))
        pk = max([d[2] if d else 0] + [x.get('pk') or 0 for x in live])
        return n, g, pk

    rows, hot = [], {}
    for t in cand:
        m = t['mint']; mk = t.get('market') or {}; j = JC.get(m) or {}; st = j.get('stats24h') or {}
        vol = mk.get('volume24hUsd') or 0
        jv = (st.get('buyVolume') or 0) + (st.get('sellVolume') or 0); ov = (st.get('buyOrganicVolume') or 0) + (st.get('sellOrganicVolume') or 0)
        ob = st.get('numOrganicBuyers') or 0; holders = j.get('holderCount') or 0
        top = (j.get('audit') or {}).get('topHoldersPercentage')
        rw = state['rw'].get(m) if t.get('mode') == 'reward' else None
        fb = rw[0] / (rw[1] / 1e4) / vol if rw and rw[1] and vol else None   # fee-backed share of the volume
        dev = state['live'].get(m, {}).get('dev'); n, g, pk = dev_rec(dev, m)
        # the score
        s_ob = 30 * min(1, math.log10(1 + ob) / 2)
        s_fb = 20 * min(1, fb / 0.7) if fb is not None else 20 * min(1, (ov / jv if jv else 0) / 0.08) * 0.6   # no payouts to check: organic share, at most 12
        s_h = 15 * min(1, math.log10(1 + holders) / 3)
        s_top = 10 * max(0, min(1, (80 - top) / 50)) if top is not None else 5
        s_dev = 15 if (g and g / n >= 0.2) or pk >= 500000 else 0 if n >= 5 and g / n < 0.1 else 7   # proven dev / serial launcher / unknown
        s_ov = 10 * min(1, (ov / jv if jv else 0) / 0.08)
        score = round(s_ob + s_fb + s_h + s_top + s_dev + s_ov)
        farm = vol >= 20000 and (fb < 0.45 if fb is not None else ob < 5)
        verdict = 'REAL' if score >= 60 and not farm else 'FARM' if farm else 'WATCH' if score >= 35 else 'THIN'
        q = t.get('quote') or {}
        row = {'m': m, 's': t.get('symbol'), 'n': t.get('name'), 'i': img(t.get('imageUrl')), 'c': ts(t.get('createdAt')),
               'q': q.get('symbol'), 'qm': q.get('mint'), 'qc': q.get('categoryLabel'), 'mode': t.get('mode'), 'st': t.get('status'),
               'gp': round(t.get('graduationProgress') or 0, 2), 'mc': round(mk.get('marketCapUsd') or 0), 'pk': round(mk.get('peakMarketCapUsd') or 0),
               'v': round(vol), 'ch': mk.get('priceChange24h'), 'ob': ob, 'h': holders, 'top': round(top, 1) if top is not None else None,
               'org': round(ov / jv * 100, 1) if jv else None, 'paid': rw[0] if rw else None, 'tax': rw[1] if rw else None,
               'fb': round(fb, 2) if fb is not None else None, 'dev': dev, 'dn': n, 'dg': g, 'dpk': round(pk),
               'score': score, 'vd': verdict}
        rows.append(row)
        h = hot.setdefault(q.get('mint'), {'qm': q.get('mint'), 'q': q.get('symbol'), 'qc': q.get('categoryLabel'), 'n': 0, 'v': 0, 'real': 0, 'best': None})
        h['v'] += vol; h['real'] += verdict == 'REAL'
        if verdict == 'REAL' and (not h['best'] or score > h['best'][1]): h['best'] = [t.get('symbol'), score, m]
        # 4. a launch turning REAL (once a launch; the first pass only records)
        if verdict == 'REAL' and m not in state['fired']:
            state['fired'][m] = now
            if not first_live:
                sig('launch', m, f"${t.get('symbol')} on the ${q.get('symbol')} pair scores {score} REAL: {ob} organic buyers, {holders:,} holders"
                    + (f", ${rw[0]:,.0f} paid to holders" if rw and rw[0] else '') + (f", dev's other coins: {g}/{n} graduated" if n else ', first launch from this dev'),
                    m, t.get('symbol'), img(t.get('imageUrl')), mk.get('marketCapUsd') or 0, 'buy')
    for t in feed:
        h = hot.setdefault((t.get('quote') or {}).get('mint'), {'qm': (t.get('quote') or {}).get('mint'), 'q': (t.get('quote') or {}).get('symbol'),
                                                              'qc': (t.get('quote') or {}).get('categoryLabel'), 'n': 0, 'v': 0, 'real': 0, 'best': None})
        h['n'] += 1
    for h in hot.values():
        h['v'] = round(h['v']); h['new'] = state['pairs'].get(h['qm']) or 0
    hot = sorted(hot.values(), key=lambda h: (-h['real'], -h['v']))[:40]
    rows.sort(key=lambda r: (-r['score'], -r['v']))
    stats = {'launches': len(feed), 'graduated': sum(1 for t in feed if t.get('status') == 'graduated'), 'scored': len(rows),
             'real': sum(r['vd'] == 'REAL' for r in rows), 'farm': sum(r['vd'] == 'FARM' for r in rows),
             'devs': len(state['devs']) + len({x.get('dev') for x in state['live'].values()} - set(state['devs']))}
else:
    rows, hot, stats = load('launches.json', {}).get('launches', []), load('launches.json', {}).get('hot', []), load('launches.json', {}).get('stats', {})

# ---------- dev records further back (every 30 min, 25 older pages a pass, back to 14 days) ----------
if FULL and feed:
    bf = state.setdefault('bf', {'page': max(1, page - 1), 'before': now - WINDOW})
    for _ in range(BF_PAGES):
        if bf['before'] < now - BF_DAYS * 86400: break
        try: L = get(f"{SF}/api/public/v1/tokens?sort=newest&pageSize=100&page={bf['page']}")['data']['tokens']
        except Exception as e: log('backfill', bf['page'], e); break
        if not L: break
        old = [t for t in L if ts(t.get('createdAt')) < bf['before']]
        J = jup([t['mint'] for t in old])
        for t in old:
            dev = (J.get(t['mint']) or {}).get('dev')
            if not dev: continue
            d = state['devs'].setdefault(dev, [0, 0, 0, 0])
            d[0] += 1; d[1] += t.get('status') == 'graduated'; d[2] = max(d[2], round((t.get('market') or {}).get('peakMarketCapUsd') or 0))
            d[3] = max(d[3], ts(t.get('createdAt')))
        if old: bf['before'] = min(ts(t.get('createdAt')) for t in old)
        bf['page'] += 1; time.sleep(0.3)
    log(f"dev records: {len(state['devs'])} devs, backfilled to {time.strftime('%F %H:%M', time.gmtime(bf['before']))}")
if FULL: state['fullAt'] = now

# ---------- save ----------
prev = load('launches.json', {})
old_t = {s['id']: s['t'] for s in prev.get('signals', [])}
for s in signals: s['t'] = old_t.get(s['id'], s['t'])
have = {s['id'] for s in signals}
signals += [s for s in prev.get('signals', []) if s['id'] not in have and s['t'] > now - 3 * 86400]
signals.sort(key=lambda s: -s['t'])
new_pairs = sorted([{'m': m, 's': (pairs.get(m) or {}).get('symbol'), 'n': (pairs.get(m) or {}).get('name'), 'cat': cat_of.get(m),
                     'i': img((pairs.get(m) or {}).get('logoUrl')), 't': t} for m, t in state['pairs'].items() if t], key=lambda p: -p['t'])[:30]
vrfd = [dict(v, n=state['subs'].get(v['by'], 1)) for v in reversed(state['vrfd'][-30:])]
save('launches.json', {'at': now, 'stats': stats, 'pairs': len(pairs) or len(state['pairs']), 'newPairs': new_pairs, 'vrfd': vrfd,
                       'listers': LISTERS, 'pending': pending, 'hot': hot, 'launches': rows[:200], 'signals': signals[:120]})
save('launches-state.json', state)
log(f"done{' (full)' if FULL else ''}: {stats.get('launches', 0)} launches in 24 h, {stats.get('real', 0)} REAL, {stats.get('farm', 0)} FARM, "
    f"{len(pending)} pending listings, {len(new_pairs)} new pairs, {len(signals)} signals")
