#!/usr/bin/env python3
"""Compound score from fetch.py's output.

usage: score.py IN.json NAME REWARD_NAME OUT.json

Rewards are only counted when they came from THIS token's payout rounds. stonkfun pays every token that rewards in (say)
LINK from shared payout wallets, so a holder's LINK can come from several tokens. A round of this token pays every eligible
holder at the same moment, in proportion to their balance of this token, so its payouts share one rate (reward tokens per
token held). Payouts are grouped into bursts (<15 min apart); in each burst the rate most payouts agree on (within 20%) is
this token's round, and only payouts at that rate are counted.

Per holder, over the window, counting only what happened after their first reward (their entry buy isn't compounding):
  R    rewards from this token, $ at the time
  N    net buys of the token ($ bought - $ sold)
  c    compound rate = min(max(N, 0), R) / R            share of rewards matched by new buying
  k    consistency  = share of days with a reward on which they bought the token (that day or the next)
  score = 100 x (0.7 c + 0.3 k), 0 for a net seller
  tags: Extractor (net seller) · Compounder (c >= 50%) · Partial (10-50%) · Cash-out (sold half+ of R's worth of the
        reward token for SOL/USDC, c < 10%) · Collector (holds the rewards)
Token: holding-weighted average score, share of rewards compounded, share of supply in each tag.
"""
import bisect, json, sys, time, urllib.request
from statistics import median

D = json.load(open(sys.argv[1])); XN, QN, OUT = sys.argv[2], sys.argv[3], sys.argv[4]
X, Q, START = D['mint'], D['quote'], D['start']
SOL = 'So11111111111111111111111111111111111111112'
STABLE = {'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'}
DAY = 86400


# ---------- prices: GeckoTerminal 1h candles of each token's busiest pool ----------
def get(u):
    for i in range(4):
        try: return json.load(urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': 'war-room-compound'}), timeout=30))
        except Exception:
            time.sleep(5 * (i + 1))
    return None


def series(mint):
    p = get(f'https://api.geckoterminal.com/api/v2/networks/solana/tokens/{mint}/pools?page=1')
    if not p or not p.get('data'): return []
    pool = p['data'][0]; side = 'base' if pool['relationships']['base_token']['data']['id'].endswith(mint) else 'quote'
    out, before = [], int(time.time())
    for _ in range(12):                     # 1,000 hours a call; stop when it stops going back in time
        if before <= START - 3600: break
        time.sleep(2.2)
        r = get(f"https://api.geckoterminal.com/api/v2/networks/solana/pools/{pool['attributes']['address']}/ohlcv/hour?aggregate=1&limit=1000&before_timestamp={before}&token={side}")
        rows = ((r or {}).get('data') or {}).get('attributes', {}).get('ohlcv_list') or []
        if not rows: break
        out += [(int(x[0]), float(x[4])) for x in rows]
        if min(int(x[0]) for x in rows) >= before: break
        before = min(int(x[0]) for x in rows)
    return sorted(set(out))


PX = {m: series(m) for m in (X, Q, SOL)}
TS = {m: [t for t, _ in s] for m, s in PX.items()}


def px(m, t):
    if m in STABLE: return 1.0
    s = PX.get(m)
    if not s: return 0.0
    i = max(bisect.bisect_right(TS[m], t) - 1, 0); return s[i][1]


usd = lambda m, a, t: a * px(m, t)

# ---------- balances over time and payout events ----------
H = D['holders']; events = []
for w, d in H.items():
    bal = d['bal']
    for tx in reversed(d['tx']):          # walk back from today's balance: balance just before each transaction
        tx['after'] = bal; bal -= tx['ch'].get(X, 0); tx['before'] = bal
    for tx in d['tx']:
        a = tx['ch'].get(Q, 0)
        # a payout: reward tokens arrived, nothing else moved, the holder didn't sign (whoever sent it: stonkfun has used
        # more than one payout wallet); the round matching below decides whether it was this token's
        if a > 0 and not tx['signer'] and all(abs(v) < 1e-6 for m, v in tx['ch'].items() if m != Q) and tx['before'] > 0:
            events.append({'w': w, 't': tx['t'], 'a': a, 'rate': a / tx['before'], 'tx': tx})
events.sort(key=lambda e: e['t'])

# ---------- this token's rounds ----------
rounds, burst = [], []
def close(B):
    if len(B) < 3: return
    best = max(B, key=lambda e: sum(1 for f in B if abs(f['rate'] / e['rate'] - 1) <= 0.2))
    mine = [f for f in B if abs(f['rate'] / best['rate'] - 1) <= 0.2]
    if len({f['w'] for f in mine}) >= 3:
        r = median(f['rate'] for f in mine); mine = [f for f in B if abs(f['rate'] / r - 1) <= 0.2]
        for f in mine: f['tx']['mine'] = True
        rounds.append({'t': min(f['t'] for f in mine), 'rate': r, 'paid': len({f['w'] for f in mine}), 'usd': sum(usd(Q, f['a'], f['t']) for f in mine)})
for e in events:
    if burst and e['t'] - burst[-1]['t'] > 900: close(burst); burst = []
    burst.append(e)
close(burst)
mine_n = sum(1 for e in events if e['tx'].get('mine')); mine_q = sum(e['a'] for e in events if e['tx'].get('mine'))

# ---------- per holder ----------
rows = []
for w, d in H.items():
    R = B = S = Bq = Qcash = 0.0; rdays, bdays = set(), set(); first = None
    for tx in d['tx']:
        t, ch = tx['t'], tx['ch']
        if tx.get('mine'):
            first = first or t; R += usd(Q, ch[Q], t); rdays.add((t - START) // DAY); continue
        if first is None: continue
        dx, dq = ch.get(X, 0), ch.get(Q, 0)
        other = {m: v for m, v in ch.items() if m != X and not (m == SOL and abs(v) < 0.01)}
        out_ = sum(-usd(m, v, t) for m, v in other.items() if v < 0); in_ = sum(usd(m, v, t) for m, v in other.items() if v > 0)
        if dx > 0 and out_ > 0: B += out_; bdays.add((t - START) // DAY); Bq += usd(Q, -dq, t) if dq < 0 else 0
        elif dx < 0 and in_ > 0: S += in_
        elif dx == 0 and dq < 0 and any(v > 0 and (m == SOL or m in STABLE) for m, v in other.items()): Qcash += usd(Q, -dq, t)
    if not R: continue
    N = B - S; c = min(max(N, 0), R) / R
    k = sum(1 for dd in rdays if dd in bdays or dd + 1 in bdays) / len(rdays)
    score = round(100 * (0.7 * c + 0.3 * k)) if N >= 0 else 0
    tag = ('Extractor' if N < 0 else 'Compounder' if c >= 0.5 else 'Partial' if c >= 0.1 else
           'Cash-out' if Qcash >= 0.5 * R else 'Collector')
    rows.append({'w': w, 'pct': round(d['pct'], 3), 'R': round(R, 2), 'B': round(B, 2), 'S': round(S, 2), 'N': round(N, 2), 'direct': round(Bq, 2),
                 'cash': round(Qcash, 2), 'c': round(c, 3), 'k': round(k, 3), 'mult': round(N / R, 2), 'score': score, 'tag': tag})
rows.sort(key=lambda r: -r['pct'])

W = sum(r['pct'] for r in rows) or 1
tok = {'token': XN, 'reward': QN, 'from': START, 'to': int(time.time()), 'holders': len(H), 'scored': len(rows),
       'supply_pct': round(sum(d['pct'] for d in H.values()), 1),
       'score': round(sum(r['pct'] * r['score'] for r in rows) / W, 1),
       'compounded_pct': round(100 * sum(min(r['R'], max(r['N'], 0)) for r in rows) / (sum(r['R'] for r in rows) or 1), 1),
       'fresh_multiple': round(sum(max(r['N'], 0) for r in rows) / (sum(r['R'] for r in rows) or 1), 2),
       'rewards': round(sum(r['R'] for r in rows)), 'bought': round(sum(r['B'] for r in rows)), 'sold': round(sum(r['S'] for r in rows)),
       'tags': {t: {'n': sum(1 for r in rows if r['tag'] == t), 'supply_pct': round(sum(r['pct'] for r in rows if r['tag'] == t), 2)}
                for t in ('Compounder', 'Partial', 'Collector', 'Cash-out', 'Extractor')},
       'check': {'payouts_seen': len(events), 'from_this_token': mine_n, 'rounds': len(rounds), 'reward_tokens_from_this_token': round(mine_q, 4),
                 'reward_tokens_all': round(sum(e['a'] for e in events), 4), 'last_round': rounds[-1]['t'] if rounds else None,
                 'prices': {k: len(v) for k, v in PX.items()}}}
json.dump({'token': tok, 'holders': rows, 'rounds': rounds}, open(OUT, 'w'))
print(json.dumps(tok, indent=1))
print(f"{'wallet':9} {'hold%':>6} {'rewards':>8} {'bought':>8} {'sold':>8} {'direct':>7} {'cashout':>7} {'c':>5} {'k':>5} {'mult':>6} {'score':>5}  tag")
for r in rows:
    print(f"{r['w'][:8]:9} {r['pct']:6.2f} {r['R']:8.0f} {r['B']:8.0f} {r['S']:8.0f} {r['direct']:7.0f} {r['cash']:7.0f} {r['c']:5.2f} {r['k']:5.2f} {r['mult']:6.1f} {r['score']:5}  {r['tag']}")
