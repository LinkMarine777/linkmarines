#!/usr/bin/env python3
"""Launch radar: which stonkfun launches are real, which are farmed or bundled, and what's about to be listed.

Runs on GitHub Actions (.github/workflows/launches.yml, a pass every ~5 min) and writes into the data branch:
  terminal/launches.json        what /launches/ reads (and the whale radar folds its signals into the shared alerts)
  terminal/launches-state.json  memory between passes: pairs seen, VRFD requests, launches, funders, scans

Sources (all free, no RPC): stonkfun's public API; Jupiter's data API (datapi.jup.ag: the numbers jup.ag's token page
shows: fees paid, bundlers, dev record, holders and who funded them); Jupiter VRFD's public request list
(token-verify-api.jup.ag: every verification request, its lane and status).

Alerts (each fires once):
  vrfd      a stonkfun coin asks Jupiter VRFD for verification (⚡ express = paid 1,000 JUP), or VRFD verifies it
  sunrise   a stock issuer stonkfun pairs with (Sunrise, xStocks, PreStocks, Tessera) issues a stock, or Sunrise asks VRFD to
            verify one / VRFD verifies it, and no stonkfun pair trades that stock yet (WLD: express at 21:09, verified
            21:30, a pair that evening)
  newpair   stonkfun's pair list gains a quote token: coins can launch against it now
  launch    a launch from the last 24 h scores REAL (below), the first time it does

The REAL score (0-100) of each launch from the last 24 h that trades ($2,500+ volume or graduated):
  organic buyers 25  Jupiter's distinct organic buyers in 24 h (bots and wash wallets filtered out by Jupiter)
  fee-backed     20  what the coin paid its holders divided by its tax rate, against the volume it reports. A taxed
                     trade always pays: real trading comes out near 1.0, washed volume far below (farms 0.15-0.45)
  bundles        15  held now: the bigger of what bundlers hold (Jupiter's Bundlers H.) and linked holders (top 100 holders
                     funded by one private wallet: not an exchange or a service that funds wallets across many coins)
  dev            15  the deployer's lifetime record (Jupiter's 👑 graduated / coins launched, this coin left out):
                     1 in 5 graduated = 15, a serial launcher (5+ coins, under 1 in 20 graduated) = 0; 2,000+ coins is
                     a launch tool's wallet (shared by many people): neutral
  holders        10  Jupiter's holder count
  top 10          5  the top 10 holders' share (less is better)
  organic vol     5  Jupiter's organic share of the volume
  fees / trade    5  priority fees + tips traders paid per trade (Jupiter's Fees Paid). Farm bots pay to land their
                     bundles: farms measured 2.3-5 mSOL a trade, real coins 0.7-2.7
minus up to 30 for the drop from the peak market cap (none down to 50% off, all 30 at 95% off), minus up to 10 when
bundlers held 10%+ at their peak and have sold most of it (sold into the pump)
REAL 60+ (not bundled: 20%+ bundled or linked caps it at WATCH; not dumped: 85%+ below a $20K+ peak does too), WATCH 35+,
FARM = $20,000+ volume the fees don't back up (under 0.45, with under 20 organic buyers or 60 holders; with no payouts to check: under 5 organic buyers),
THIN otherwise.
"""
import calendar, json, math, os, re, sys, time, urllib.request

OUT = sys.argv[1] if len(sys.argv) > 1 else 'terminal'
SF = 'https://www.stonkfun.xyz'
DAPI = 'https://datapi.jup.ag/v1'
VAPI = 'https://token-verify-api.jup.ag'
SUNRISE = {'EMUCNjWt8AUQXUEjUnCDqqjDqLb63Trios1TnoUPvoJN'}   # Sunrise's VRFD submitter wallet
STOCKY = {'stocks', 'rwa', 'xstocks', 'backpack', 'prestocks', 'equities'}   # Jupiter tags of the assets stonkfun pairs with
# exchange hot wallets that fund wallets (any other funder seen behind holders of FAN_OUT+ coins counts as an exchange / service)
EXCHANGES = {'5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9': 'Binance', 'H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS': 'Coinbase',
             'GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE': 'Coinbase', '5VCwKtCXgCJ6kit5FybXjvriW3xELsFDhYrPSqtJNmcD': 'OKX',
             'AC5RDfQFmDS1deWZos921JfqscXdByf8BKHs5ACWjtW2': 'Bybit', 'ASTyfSima4LLAdDgoFGkgqoKowG1LZFDr9fAQrg7iaJZ': 'MEXC'}
FAN_OUT, SCANS, WINDOW = 4, 25, 86400   # a funder behind 4+ coins is a service; 25 holder scans a pass (kept 30 min); launches scored 24 h
now = int(time.time())


def log(*a): print(*a, flush=True)


def get(url, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'war-room-launches'}), timeout=40) as r:
                return json.load(r)
        except Exception as e:
            if i == tries - 1 or ' 404' in str(e): raise
            time.sleep(2 * (i + 1) if '429' in str(e) else 1)


def load(name, default):
    try: return json.load(open(os.path.join(OUT, name)))
    except Exception: return default


def save(name, data):
    tmp = os.path.join(OUT, name + '.tmp')
    json.dump(data, open(tmp, 'w'), separators=(',', ':')); os.replace(tmp, os.path.join(OUT, name))


def ts(iso):
    try: return calendar.timegm(time.strptime((iso or '')[:19].replace(' ', 'T'), '%Y-%m-%dT%H:%M:%S'))
    except Exception: return 0


def img(u): return (SF + u) if u and u.startswith('/') else u


def assets(mints):
    """jup.ag's token data (100 a call): fees paid, audit (bundlers, dev record), stats, socials."""
    out = {}
    for i in range(0, len(mints), 100):
        try:
            for x in get(f'{DAPI}/assets/search?query=' + ','.join(mints[i:i + 100])) or []: out[x['id']] = x
        except Exception as e: log('jupiter assets', e)
        time.sleep(0.2)
    return out


state = load('launches-state.json', {})
for k in ('devs', 'bf', 'vrfd', 'subs', 'vrfdLast', 'verified'): state.pop(k, None)   # the first version's on-chain VRFD feed + dev backfill
for k, v in (('pairs', {}), ('live', {}), ('rw', {}), ('fired', {}), ('vr', {}), ('sun', {}), ('sf', {}), ('fan', {}), ('scan', {}), ('busy', {})):
    state.setdefault(k, v)
FULL = os.environ.get('FULL') == '1' or now - state.get('fullAt', 0) > 1800   # Jupiter's verified list: every 30 min
signals = []
def sig(kind, key, text, mint=None, sym=None, image=None, usd=0, side=None):
    signals.append({'id': f'{kind}:{key}', 'kind': kind, 't': now, 'text': text, 'm': mint, 's': sym, 'i': image, 'u': round(usd or 0), 'side': side})

# ---------- stonkfun's pairs: a quote token appearing is a new pair ----------
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


def stock_keys(sym, name, xstock=False, tessera=False):
    """What identifies the stock behind a token, to spot a stock that already has a pair (Sunrise's SPCX vs the SPCXX xStock,
    Tessera's tSpaceX vs the SPACEX PreStock)."""
    if tessera: sym = re.sub(r'^t-?', '', sym or ''); name = re.sub(r'(?i)^t-', '', name or '')
    s = re.sub(r'[^A-Z0-9]', '', (sym or '').upper())
    if xstock and len(s) > 2 and s.endswith('X'): s = s[:-1]
    n = re.sub(r'\b(xstocks?|prestocks?|backpack securities|tokenized|inc|corp|class [a-c])\b', '', (name or '').lower().split(' - ')[0])
    return {s, re.sub(r'[^a-z0-9]', '', n)} - {''}
paired_stock = set()
for p in pairs.values():
    if p.get('category') in ('xstock', 'prestock', 'backpack', 'tessera'):
        paired_stock |= stock_keys(p.get('symbol'), p.get('name'), p.get('category') == 'xstock', p.get('category') == 'tessera')

# ---------- the last 24 h of launches (stonkfun's newest first) ----------
feed, page = [], 1
while page <= 25:
    try: L = get(f'{SF}/api/public/v1/tokens?sort=newest&pageSize=100&page={page}')['data']['tokens']
    except Exception as e: log('newest', page, e); break
    feed += L
    if not L or ts(L[-1].get('createdAt')) < now - WINDOW: break
    page += 1; time.sleep(0.3)
feed = [t for t in feed if ts(t.get('createdAt')) >= now - WINDOW]
by_mint = {t['mint']: t for t in feed}
log(f'{len(feed)} launches in 24 h ({page} pages)')


def sf_coin(m):
    """A stonkfun coin? (symbol, market cap, image), remembered; None if it isn't one."""
    if m in by_mint: t = by_mint[m]
    elif m in state['sf']: return state['sf'][m] or None
    else:
        try: t = get(f'{SF}/api/public/v1/tokens/{m}')['data']['token']
        except Exception: t = None
        time.sleep(0.15)
    v = [t.get('symbol'), round((t.get('market') or {}).get('marketCapUsd') or 0), img(t.get('imageUrl'))] if t else 0
    if m not in by_mint: state['sf'][m] = v
    return v or None

# ---------- Jupiter VRFD: stonkfun coins asking to be verified, and Sunrise's next stocks ----------
LANE = {'premium': 'express', 'basic': 'standard'}
try:
    first_v = 'vLast' not in state
    reqs = []
    for p in (1, 2) if first_v else (1,):
        reqs += get(f'{VAPI}/verifications/search?limit=100&page={p}')['data']['data']
    for x in sorted(reqs, key=lambda x: x['id']):
        if x['id'] <= state.get('vLast', 0): continue
        m, lane = x['tokenId'], LANE.get(x.get('verificationTier'), x.get('verificationTier'))
        row = {'id': x['id'], 'lane': lane, 'st': x.get('status'), 't': ts(x.get('createdAt')), 'x': x.get('twitterHandle')}
        if x.get('walletAddress') in SUNRISE:
            state['sun'][m] = row
            if not first_v: log('sunrise vrfd request', m)
            continue
        c = sf_coin(m)
        if not c: continue
        row.update({'s': c[0], 'mc': c[1], 'i': c[2]}); state['vr'][m] = row
        if not first_v:
            sig('vrfd', f"{m}:{x['id']}", f"${c[0]} asked Jupiter VRFD to verify it: " + ('⚡ EXPRESS lane, paid 1,000 JUP' if lane == 'express' else 'standard lane'),
                m, c[0], c[2], c[1], 'buy' if lane == 'express' else None)
    if reqs: state['vLast'] = max(state.get('vLast', 0), max(x['id'] for x in reqs))
    # pending ones: has VRFD decided? (oldest checks first, 15 a pass)
    todo = sorted([(r.get('ck', 0), m, k) for k in ('vr', 'sun') for m, r in state[k].items() if r['st'] in ('pending', 'needs_info')])[:15]
    for _, m, k in todo:
        r = state[k][m]; r['ck'] = now
        try: d = get(f'{VAPI}/verifications/token/{m}')['data'] or {}
        except Exception as e: log('vrfd status', m[:6], e); continue
        time.sleep(0.15)
        st = d.get('status') or r['st']
        if st != r['st'] and st == 'verified' and k == 'vr':
            sig('vrfd', f'{m}:verified', f"Jupiter VRFD verified ${r['s']} ({r['lane']} lane): the verified badge on Jupiter now", m, r['s'], r.get('i'), r.get('mc'), 'buy')
        r['st'] = st
    for k in ('vr', 'sun'):   # two weeks of requests
        for m in [m for m, r in state[k].items() if r['t'] < now - 14 * 86400]: state[k].pop(m)
except Exception as e: log('vrfd', e)

# ---------- next pairs: every issuer's stocks with no stonkfun pair for that stock yet ----------
# stonkfun pairs stocks from four issuers, each with its own Jupiter tag. Most of the issuers' tokens are left out: Sunrise
# lists nearly all of its stocks as pairs, xStocks only its busiest (24 of 1,274), so an xStock shows here only when it
# trades, is new, or went to VRFD. A stock stonkfun already pairs in any wrapper is left out (it never pairs two).
ISSUERS = {'backpack': 'Sunrise', 'xstocks': 'xStock', 'prestocks': 'PreStock', 'tessera': 'Tessera'}
nxt = load('launches.json', {}).get('next', [])
if FULL:
    try:
        V = get('https://lite-api.jup.ag/tokens/v2/tag?query=verified')
        iss = {}
        for x in V:
            lab = next((l for t, l in ISSUERS.items() if t in (x.get('tags') or [])), None)
            if lab: iss[x['id']] = (lab, x)
        for m in set(state['sun']) - set(iss): iss[m] = ('Sunrise', None)   # Sunrise's VRFD requests, verified or not
        meta = assets([m for m, (l, x) in iss.items() if x is None])
        listed = {}
        for m, (lab, x) in iss.items(): listed.setdefault(lab, [0, 0]); listed[lab][1] += 1; listed[lab][0] += m in pairs
        first_iss = 'iss' not in state; seen = state.setdefault('iss', {})
        nxt = []
        for m, (lab, x) in iss.items():
            if m in pairs: continue
            x = x or meta.get(m) or {}
            if stock_keys(x.get('symbol'), x.get('name'), lab == 'xStock', lab == 'Tessera') & paired_stock: continue   # it trades in another wrapper
            st24 = x.get('stats24h') or {}; vol = (st24.get('buyVolume') or 0) + (st24.get('sellVolume') or 0)
            c = ts(x.get('createdAt')); r = state['sun'].get(m) or {}
            new = c > now - 14 * 86400 or (not first_iss and m not in seen)
            seen.setdefault(m, now)
            if lab == 'xStock' and not (vol >= 5000 or (x.get('liquidity') or 0) >= 25000 or new or r): continue
            nxt.append({'m': m, 's': x.get('symbol'), 'n': x.get('name'), 'i': x.get('icon'), 'iss': lab, 'liq': round(x.get('liquidity') or 0),
                        'v': round(vol), 'h': x.get('holderCount') or 0, 'ver': bool(x.get('isVerified')) or r.get('st') == 'verified',
                        'lane': r.get('lane'), 'st': r.get('st'), 'req': r.get('t'), 'c': c, 'new': bool(new)})
            # an alert when a stock first shows up (issued, or sent to VRFD) and when Sunrise's VRFD request is verified
            key = f"{m}:{'verified' if nxt[-1]['ver'] else 'asked'}" if r else f'{m}:issued'
            if (r or new) and key not in state['fired'] and not first_v and not first_iss:
                state['fired'][key] = now
                what = ('is verified on Jupiter' if nxt[-1]['ver'] else f"went to Jupiter VRFD ({r.get('lane')} lane)") if r else 'is new on chain'
                sig('sunrise', key, f"{lab}'s ${x.get('symbol')} {what}: no stonkfun pair trades this stock yet, and stonkfun lists {lab} stocks",
                    m, x.get('symbol'), x.get('icon'))
        nxt.sort(key=lambda r: (-(r['req'] or 0), not r['new'], -r['v'], -r['liq']))
        state['issListed'] = listed; state['sunListed'] = listed.get('Sunrise')
    except Exception as e: log('next pairs', e)

# ---------- score the launches that trade ----------
first_live = not state['live']
for m in [m for m, x in state['live'].items() if x['c'] < now - WINDOW]:   # out of the window
    state['live'].pop(m); state['rw'].pop(m, None); state['fired'].pop(m, None); state['scan'].pop(m, None)
for m, t in by_mint.items(): state['live'].setdefault(m, {'c': ts(t['createdAt'])})
cand = sorted([t for t in feed if ((t.get('market') or {}).get('volume24hUsd') or 0) >= 2500 or t.get('status') == 'graduated'],
              key=lambda t: -((t.get('market') or {}).get('volume24hUsd') or 0))[:400]
A = assets([t['mint'] for t in cand])
sol = 0
try: sol = get('https://lite-api.jup.ag/price/v3?ids=So11111111111111111111111111111111111111112')['So11111111111111111111111111111111111111112']['usdPrice']
except Exception as e: log('sol price', e)

# stonkfun's payouts (cached 15 min a coin): the fee-backed check
looked = 0
for t in cand[:150]:
    if t.get('mode') != 'reward': continue
    r = state['rw'].get(t['mint'])
    if (r and now - r[3] < 900) or looked >= 40: continue
    looked += 1; time.sleep(0.2)
    try:
        d = get(f"{SF}/api/rewards?mint={t['mint']}")
        state['rw'][t['mint']] = [round((d.get('distributedUsd') or 0) + (d.get('pendingUsd') or 0) + (d.get('pendingTaxUsd') or 0), 2),
                                  d.get('transferTaxBps') or 0, d.get('holderCount') or 0, now]
    except Exception as e: log('rewards', t['symbol'], e)


RPC = 'https://solana-rpc.publicnode.com'
def busy(f):
    """An app or exchange wallet (Fomo, pump.fun, onramps, hot wallets) funds thousands of strangers: its last 100 transactions
    span hours. A private bundler's span days or weeks. Checked on chain, remembered a day."""
    c = state['busy'].get(f)
    if c and now - c[1] < 86400: return c[0]
    try:
        q = urllib.request.Request(RPC, data=json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'getSignaturesForAddress', 'params': [f, {'limit': 100}]}).encode(),
                                   headers={'Content-Type': 'application/json', 'User-Agent': 'war-room-radar'})
        r = json.load(urllib.request.urlopen(q, timeout=20))
        sg = r['result']
    except Exception as e: log('busy', f[:6], e); return False
    b = len(sg) >= 100 and (sg[0].get('blockTime') or 0) - (sg[-1].get('blockTime') or 0) < 2 * 86400
    state['busy'][f] = [b, now]; time.sleep(0.25)
    return b


def holder_scan(m, a, created):
    """The bundle scan: jup.ag's top 100 holders, who funded each, Jupiter's sniper / insider tags."""
    H = get(f'{DAPI}/holders/{m}').get('holders') or []
    supply = a.get('circSupply') or a.get('totalSupply') or 0
    if not supply: return None
    pct = lambda x: x['amount'] / supply * 100
    H = [x for x in H if not any(k in (t.get('id') or '') for t in x.get('tags') or [] for k in ('Pool', 'Bonding Curve', 'Vault'))]
    tagged = lambda tag: round(sum(pct(x) for x in H if tag in (x.get('holderTags') or [])), 2)
    by_f, src, sp, fresh = {}, {}, {}, 0
    def add(k, p): src[k] = src.get(k, 0) + 1; sp[k] = sp.get(k, 0) + p
    for x in H:
        ai = x.get('addressInfo') or {}; f = ai.get('fundingAddress')
        if not f: add('unknown', pct(x)); continue
        if created and ts(ai.get('fundingBlockTime')) >= created - 2 * 86400: fresh += 1   # a wallet made for this launch
        fan = state['fan'].setdefault(f, [])
        if m not in fan and len(fan) < FAN_OUT + 1: fan.append(m)
        by_f.setdefault(f, []).append(x)
    clusters = []
    for f, xs in by_f.items():
        name = EXCHANGES.get(f) or ('exchange / service' if len(state['fan'].get(f, [])) >= FAN_OUT else None)
        if name: [add(name, pct(x)) for x in xs]; continue
        if len(xs) >= 2 and busy(f): [add('app / exchange wallet', pct(x)) for x in xs]; continue   # not a link
        if len(xs) >= 2: clusters.append([f, len(xs), round(sum(pct(x) for x in xs), 2)]); [add('linked', pct(x)) for x in xs]
        else: add('independent', pct(xs[0]))
    clusters.sort(key=lambda c: -c[2])
    return {'sn': tagged('sniper'), 'in': tagged('insider'), 'lk': round(sum(c[2] for c in clusters), 2), 'cl': clusters[:6], 'nc': len(clusters),
            'sp': {k: round(v, 2) for k, v in sp.items()},
            'src': {k: v for k, v in sorted(src.items(), key=lambda kv: -kv[1]) if v}, 'fresh': fresh, 'n': len(H), 'at': now}

rows, hot, scanned = [], {}, 0
for t in cand:
    m = t['mint']; mk = t.get('market') or {}; a = A.get(m) or {}; au = a.get('audit') or {}; st = a.get('stats24h') or {}
    vol = mk.get('volume24hUsd') or 0
    jv = (st.get('buyVolume') or 0) + (st.get('sellVolume') or 0); ov = (st.get('buyOrganicVolume') or 0) + (st.get('sellOrganicVolume') or 0)
    trades = (st.get('numBuys') or 0) + (st.get('numSells') or 0)
    ob = st.get('numOrganicBuyers') or 0; holders = a.get('holderCount') or 0; top = au.get('topHoldersPercentage')
    rw = state['rw'].get(m) if t.get('mode') == 'reward' else None
    fb = rw[0] / (rw[1] / 1e4) / vol if rw and rw[1] and vol else None   # fee-backed share of the volume
    fees = a.get('fees'); fpt = fees / trades * 1000 if fees is not None and trades else None   # mSOL a trade
    bs = au.get('bundlerStats') or {}; bpk = bs.get('holdingPctATH') or 0; bh = bs.get('holdingPct') or 0   # Jupiter's Bundlers H.: what they hold now (left out at 0)
    # dev record, this coin left out (Jupiter's 👑 graduated / launched)
    grad = t.get('status') == 'graduated'
    dn = (au.get('devMints') or 1) - 1; dg = max(0, (au.get('devMigrations') or 0) - (1 if grad else 0))
    sc = state['scan'].get(m)
    if (not sc or now - sc['at'] > 1800) and scanned < SCANS and a and (vol >= 10000 or grad):
        scanned += 1
        try: sc = holder_scan(m, a, ts(t.get('createdAt'))) or sc; state['scan'][m] = sc
        except Exception as e: log('holders', t.get('symbol'), e)
        time.sleep(0.4)
    bund = max(bh, (sc or {}).get('lk') or 0)   # bundled now: what bundlers and linked holders hold today, not the peak
    # the score
    s_ob = 25 * min(1, math.log10(1 + ob) / 2)
    s_fb = 20 * min(1, fb / 0.7) if fb is not None else 12 * min(1, (ov / jv if jv else 0) / 0.08)   # no payouts to check: organic share, at most 12
    s_bu = 15 * max(0, 1 - bund / 25)
    s_dev = 7 if dn < 1 or dn > 2000 or not au else 15 if dg / dn >= 0.2 else 0 if dn >= 5 and dg / dn < 0.05 else 7   # 2,000+ coins: a launch tool's wallet, not a dev
    s_h = 10 * min(1, math.log10(1 + holders) / 3)
    s_top = 5 * max(0, min(1, (80 - top) / 50)) if top is not None else 2.5
    s_ov = 5 * min(1, (ov / jv if jv else 0) / 0.08)
    s_fpt = 5 * max(0, min(1, (4 - fpt) / 2.5)) if fpt is not None else 2.5
    # what the price did: real trading that ends 95% below the peak is a pump that dumped, not a real coin; and bundlers who
    # held 10%+ at their peak and have sold most of it sold into the pump
    mc, pk = mk.get('marketCapUsd') or 0, mk.get('peakMarketCapUsd') or 0
    dd = max(0, 1 - mc / pk) if pk else 0
    p_dd = 30 * max(0, min(1, (dd - 0.5) / 0.45))
    p_bs = 10 * min(1, bpk / 25) if bpk >= 10 and bh < bpk / 2 else 0
    score = max(0, round(s_ob + s_fb + s_bu + s_dev + s_h + s_top + s_ov + s_fpt - p_dd - p_bs))
    dumped = dd >= 0.85 and pk >= 20000
    farm = vol >= 20000 and (fb < 0.45 and (ob < 20 or holders < 60) if fb is not None else ob < 5)   # payouts lag: a coin with real buyers isn't a farm
    bundled = bund >= 20
    verdict = 'FARM' if farm else 'REAL' if score >= 60 and not bundled and not dumped else 'WATCH' if score >= 35 else 'THIN'
    q = t.get('quote') or {}
    flags = (['BUNDLED'] if bundled else []) + (['DUMPED'] if dumped else [])
    vr = state['vr'].get(m)
    row = {'m': m, 's': t.get('symbol'), 'n': t.get('name'), 'i': img(t.get('imageUrl')), 'c': ts(t.get('createdAt')),
           'q': q.get('symbol'), 'qm': q.get('mint'), 'qc': q.get('categoryLabel'), 'mode': t.get('mode'), 'st': t.get('status'),
           'mc': round(mk.get('marketCapUsd') or 0), 'pk': round(mk.get('peakMarketCapUsd') or 0), 'v': round(vol),
           'ob': ob, 'h': holders, 'top': round(top, 1) if top is not None else None, 'org': round(ov / jv * 100, 1) if jv else None,
           'os': round(a.get('organicScore') or 0, 1), 'paid': rw[0] if rw else None, 'tax': rw[1] if rw else None,
           'fb': round(fb, 2) if fb is not None else None, 'fees': round(fees, 2) if fees is not None else None,
           'fpt': round(fpt, 2) if fpt is not None else None, 'feesUsd': round(fees * sol) if fees and sol else None,
           'bn': bs.get('totalBundles') or 0, 'bpk': round(bpk, 1), 'bh': round(bh, 1), 'bot': round(au.get('botHoldersPercentage') or 0, 1),
           'dev': a.get('dev'), 'dn': dn, 'dg': dg, 'scan': sc, 'flags': flags,
           'vr': {'lane': vr['lane'], 'st': vr['st']} if vr else None, 'score': score, 'vd': verdict}
    rows.append(row)
    h = hot.setdefault(q.get('mint'), {'qm': q.get('mint'), 'q': q.get('symbol'), 'qc': q.get('categoryLabel'), 'n': 0, 'v': 0, 'real': 0, 'best': None})
    h['v'] += vol; h['real'] += verdict == 'REAL'
    if verdict == 'REAL' and (not h['best'] or score > h['best'][1]): h['best'] = [t.get('symbol'), score, m]
    if verdict == 'REAL' and m not in state['fired']:   # a launch turning REAL: once a launch; the first pass only records
        state['fired'][m] = now
        if not first_live:
            sig('launch', m, f"${t.get('symbol')} on the ${q.get('symbol')} pair scores {score} REAL: {ob} organic buyers, {holders:,} holders"
                + (f", ${rw[0]:,.0f} paid to holders" if rw and rw[0] else '') + (f", bundles {bund:.0f}%" if bund >= 5 else ', no bundles')
                + (f", dev 👑 {dg} of {dn:,}" if dn else ', first coin from this dev'), m, t.get('symbol'), img(t.get('imageUrl')), mk.get('marketCapUsd') or 0, 'buy')
for t in feed:
    q = t.get('quote') or {}
    hot.setdefault(q.get('mint'), {'qm': q.get('mint'), 'q': q.get('symbol'), 'qc': q.get('categoryLabel'), 'n': 0, 'v': 0, 'real': 0, 'best': None})['n'] += 1
for h in hot.values(): h['v'] = round(h['v']); h['new'] = state['pairs'].get(h['qm']) or 0
hot = sorted(hot.values(), key=lambda h: (-h['real'], -h['v']))[:40]
rows.sort(key=lambda r: (-r['score'], -r['v']))
state['busy'] = {f: v for f, v in state['busy'].items() if v[0] or now - v[1] < 86400}   # the quiet ones only a day
if len(state['fan']) > 60000: state['fan'] = {f: v for f, v in state['fan'].items() if len(v) >= FAN_OUT}   # keep the services
stats = {'launches': len(feed), 'graduated': sum(1 for t in feed if t.get('status') == 'graduated'), 'scored': len(rows),
         'real': sum(r['vd'] == 'REAL' for r in rows), 'farm': sum(r['vd'] == 'FARM' for r in rows),
         'bundled': sum('BUNDLED' in r['flags'] for r in rows)}
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
vrfd = sorted([dict(r, m=m) for m, r in state['vr'].items()], key=lambda r: -r['t'])[:40]
for r in vrfd: r.pop('ck', None)
save('launches.json', {'at': now, 'stats': stats, 'pairs': len(pairs) or len(state['pairs']), 'newPairs': new_pairs, 'vrfd': vrfd,
                       'next': nxt, 'sunListed': state.get('sunListed'), 'issListed': state.get('issListed'), 'hot': hot, 'launches': rows[:200], 'signals': signals[:120],
                       # for the token page's own bundle scan of any coin: who funds wallets across many coins
                       'cex': EXCHANGES, 'svc': sorted({f for f, v in state['fan'].items() if len(v) >= FAN_OUT} | {f for f, v in state['busy'].items() if v[0]})})
save('launches-state.json', state)
log(f"done{' (full)' if FULL else ''}: {stats['launches']} launches in 24 h, {stats['real']} REAL, {stats['farm']} FARM, {stats['bundled']} bundled, "
    f"{scanned} holder scans, {len(vrfd)} stonkfun coins in VRFD, {len(nxt)} next pairs, {len(signals)} signals")
