#!/usr/bin/env python3
"""Prototype compounding score from fetch.py's output."""
import bisect, json, sys, time

X = sys.argv[1]; Q = sys.argv[2]; DB = sys.argv[3]; SUPPLY = float(sys.argv[4]); START = int(sys.argv[5])
SOL = 'So11111111111111111111111111111111111111112'
STABLE = {'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'}
NOT_WALLETS = {'5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1', 'GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL',
               'WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh', 'HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC'}
P = json.load(open('prices.json'))
XN, QN = sys.argv[6], sys.argv[7]
NAME = {Q: QN, SOL: 'SOL', X: XN}
series = {m: sorted((int(t), p) for t, p in P[n].items()) for m, n in NAME.items() if n in P}
BUCKET = 3 * 86400


def px(m, t):
    if m in STABLE: return 1.0
    s = series.get(m)
    if not s: return 0.0
    i = bisect.bisect_right([a for a, _ in s], t) - 1
    return s[max(i, 0)][1]


def usd(m, a, t): return a * px(m, t)


rows = []
for w, d in json.load(open(DB)).items():
    if w in NOT_WALLETS or d.get('skip'): continue
    R = B = S = Bq = Qout = Xin = Xout = 0.0
    rb, bb = set(), set()   # 3-day buckets with rewards / with buys
    for tx in d['tx']:
        t, ch = tx['t'], tx['ch']
        if t < START: continue
        dx, dq = ch.get(X, 0), ch.get(Q, 0)
        k = (t - START) // BUCKET
        if tx['payout'] and dq > 0 and not dx:
            R += usd(Q, dq, t); rb.add(k); continue
        # counter side: everything else that moved (ignore SOL dust = fees / rent)
        other = {m: v for m, v in ch.items() if m != X and not (m == SOL and abs(v) < 0.01)}
        out_usd = sum(-usd(m, v, t) for m, v in other.items() if v < 0)
        in_usd = sum(usd(m, v, t) for m, v in other.items() if v > 0)
        if dx > 0 and out_usd > 0:
            B += out_usd; bb.add(k)
            if dq < 0: Bq += usd(Q, -dq, t)
        elif dx < 0 and in_usd > 0: S += in_usd
        elif dx > 0: Xin += usd(X, dx, t)
        elif dx < 0: Xout += usd(X, -dx, t)
        elif dq < 0: Qout += usd(Q, -dq, t)   # LINK swapped / sent elsewhere, not into the token
    net = B - S
    c = min(R, max(net, 0)) / R if R else 0
    k = len(bb & rb) / len(rb) if rb else 0
    hcs = round(100 * (0.7 * c + 0.3 * k)) if net >= 0 else 0
    pct = d['bal'] / SUPPLY * 100
    tag = ('Extractor' if net < 0 or (Qout > 0.5 * R and c < 0.1) else 'Compounder' if c >= 0.5 else
           'Partial' if c >= 0.1 else 'Collector')
    rows.append(dict(w=w, pct=pct, R=R, B=B, S=S, Bq=Bq, Qout=Qout, Xin=Xin, Xout=Xout, net=net, c=c, k=k, hcs=hcs, tag=tag,
                     mult=net / R if R else None, n=len(d['tx'])))

rows.sort(key=lambda r: -r['pct'])
print(f"{'wallet':9} {'hold%':>6} {'rewards$':>9} {'bought$':>9} {'sold$':>9} {'Q→X$':>8} {'Qout$':>8} {'c':>5} {'k':>5} {'mult':>6} {'HCS':>4}  tag")
for r in rows:
    print(f"{r['w'][:8]:9} {r['pct']:6.2f} {r['R']:9.0f} {r['B']:9.0f} {r['S']:9.0f} {r['Bq']:8.0f} {r['Qout']:8.0f} {r['c']:5.2f} {r['k']:5.2f} {(r['mult'] or 0):6.1f} {r['hcs']:4}  {r['tag']}")
W = sum(r['pct'] for r in rows)
tcs = sum(r['pct'] * r['hcs'] for r in rows) / W
rate = sum(min(r['R'], max(r['net'], 0)) for r in rows) / (sum(r['R'] for r in rows) or 1)
sup = sum(r['pct'] for r in rows if r['tag'] == 'Compounder')
print(f"\nToken Compound Score (holding-weighted HCS): {tcs:.0f}/100")
print(f"Rewards compounded (all rewards, $ weighted): {rate * 100:.0f}%")
print(f"Supply held by compounders: {sup:.1f}% of supply ({sup / W * 100:.0f}% of the analysed holders' supply)")
print(f"Rewards analysed ${sum(r['R'] for r in rows):,.0f} · bought ${sum(r['B'] for r in rows):,.0f} · sold ${sum(r['S'] for r in rows):,.0f}")
json.dump(rows, open(f'scores-{XN}.json', 'w'))
