"""stonkfun payout feed -> the bot (its /rw/tick: ~20 s of reading stonkfun's own payout feed per call, for the coins the wallet
X-Ray needs). Free: no Helius credits. stonkfun refuses the bot's scheduled requests, so this calls it from GitHub. Runs until every
coin is caught up or MINUTES pass."""
import json, os, time, urllib.request

BOT = 'https://war-room-bot.linkmarine777.workers.dev'
MINUTES = float(os.environ.get('MINUTES', 50))
t0, idle = time.time(), 0
while time.time() - t0 < MINUTES * 60:
    try: d = json.load(urllib.request.urlopen(urllib.request.Request(BOT + '/rw/tick', headers={'User-Agent': 'terminal7-payout-feed'}), timeout=90))
    except Exception as e: print('tick failed:', e, flush=True); time.sleep(15); continue
    if d.get('busy'): time.sleep(10); continue
    print(f"{time.strftime('%H:%M:%S')} read {d.get('read')} payouts ({d.get('coins')} coin(s), {d.get('secs')}s) · stored {d.get('rows')} of {d.get('total')}"
          f" · {d.get('behind')} coins behind · db {d.get('dbMB')} MB{' · ' + d['err'] if d.get('err') else ''}", flush=True)
    if '429' in (d.get('err') or ''): time.sleep(30)   # stonkfun asking us to slow down
    if not d.get('coins'): idle += 1
    else: idle = 0
    if idle >= 2: break   # nothing to read
print(f'done in {round((time.time() - t0) / 60)} min', flush=True)
