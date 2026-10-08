"""Wallet X-Ray preload: reads the wallet histories the bot still needs (its /wallet-queue: saved histories that are unfinished
or were read under an older rule, then known traders never read), one round per request through /wallet/<w>?full=1, the same
call an open X-Ray page makes. Each round carries on from the wallet's saved cursor (nothing is read twice); one reader per wallet
(a visitor reading it at the same time just makes us wait). Stops when the queue is empty, when the bot's day passes its preload
budget (the queue comes back empty), or after MINUTES. No secrets: the bot spends its own Helius credits."""
import json, os, sys, time, urllib.request

BOT = 'https://war-room-bot.linkmarine777.workers.dev'
MINUTES = float(os.environ.get('MINUTES', 50))
t0 = time.time()


def get(path, timeout=90):
    r = urllib.request.Request(BOT + path, headers={'User-Agent': 'terminal7-xray-preload'})
    return json.load(urllib.request.urlopen(r, timeout=timeout))


def left():
    return MINUTES * 60 - (time.time() - t0)


done_any, skip = 0, set()
while left() > 60:
    q = get('/wallet-queue')
    ws = [w for w in q.get('wallets', []) if w not in skip]
    print(f"queue: {q.get('pending')} pending, {q.get('credits')} of {q.get('cap')} credits today", flush=True)
    if not ws: break
    w = ws[0]; rounds, last = 0, None
    while left() > 60:
        try: d = get(f'/wallet/{w}?full=1')
        except Exception as e: print(f'  {w[:6]}: {e}', flush=True); time.sleep(10); rounds += 1; continue
        h = d.get('hist') or {}; rounds += 1
        if rounds % 10 == 0 or h.get('done'): print(f"  {w[:6]} round {rounds}: {h.get('txs')} transactions{' · done' if h.get('done') else ''}", flush=True)
        if d.get('error') or h.get('done') or h.get('paused') or h.get('stale') or h.get('waited'): break
        if h.get('txs') == last and rounds > 3: break   # no progress: leave it for the next run
        last = h.get('txs')
        if rounds % 20 == 0 and not get('/wallet-queue').get('wallets'): print('  day budget reached', flush=True); sys.exit(0)
    if not (h.get('done')): skip.add(w)   # unfinished this run (paused, stale, a visitor reading it): go on with the next one
    else: done_any += 1
print(f'finished {done_any} wallet(s) in {round((time.time() - t0) / 60)} min', flush=True)
