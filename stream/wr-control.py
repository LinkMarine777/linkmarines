#!/usr/bin/env python3
"""War Room stream control bot (runs on the stream VPS).

A separate Telegram bot that long-polls Telegram (outbound HTTPS only, no open ports) and controls the
wr-stream service: pick destinations, save stream keys, start/stop, screenshots, logs, music volume.
Stream keys go Telegram -> this server only, and the message that carried a key is deleted right away.
Only Telegram user ids in ADMIN_IDS (/etc/wr-control.env) are obeyed, in private chats.
"""
import json, os, re, subprocess, time, urllib.parse, urllib.request, uuid

ENV = '/etc/wr-control.env'
CONF = '/etc/wr-stream.json'
STREAM_ENV = '/etc/wr-stream.env'
DEFAULT_URL = {'twitch': 'rtmp://live.twitch.tv/app', 'youtube': 'rtmp://a.rtmp.youtube.com/live2'}
NAMES = {'x': 'X', 'kick': 'Kick', 'twitch': 'Twitch', 'youtube': 'YouTube', 'custom': 'Custom RTMP'}
ALIASES = {'twitter': 'x', 'yt': 'youtube', 'ttv': 'twitch', 'rtmp': 'custom', 'other': 'custom'}


def load_env(path):
    out = {}
    if os.path.exists(path):
        for line in open(path):
            m = re.match(r'\s*([A-Z_]+)=(.*)', line)
            if m: out[m[1]] = m[2].strip().strip('"')
    return out


E = load_env(ENV)
TOKEN = E.get('TG_TOKEN', '')
ADMINS = {int(x) for x in re.findall(r'\d+', E.get('ADMIN_IDS', ''))}
API = f'https://api.telegram.org/bot{TOKEN}/'


def tg(method, **params):
    data = urllib.parse.urlencode({k: (json.dumps(v) if isinstance(v, (dict, list)) else v) for k, v in params.items()}).encode()
    try:
        with urllib.request.urlopen(API + method, data, timeout=70) as r: return json.load(r)
    except Exception as e:
        print('tg', method, 'failed:', str(e).replace(TOKEN, '***')); return {}


def send_photo(chat, path, caption=''):
    b = uuid.uuid4().hex
    body = (f'--{b}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n{chat}\r\n'
            f'--{b}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n{caption}\r\n'
            f'--{b}\r\nContent-Disposition: form-data; name="photo"; filename="shot.jpg"\r\nContent-Type: image/jpeg\r\n\r\n').encode()
    body += open(path, 'rb').read() + f'\r\n--{b}--\r\n'.encode()
    req = urllib.request.Request(API + 'sendPhoto', body, {'Content-Type': f'multipart/form-data; boundary={b}'})
    try: urllib.request.urlopen(req, timeout=60).read()
    except Exception as e: print('sendPhoto failed:', e)


def conf():
    try: return json.load(open(CONF))
    except Exception: return {'dests': {}, 'live': []}


def save(c):
    tmp = CONF + '.tmp'
    with open(tmp, 'w') as f: json.dump(c, f, indent=1)
    os.chmod(tmp, 0o640); subprocess.run(['chown', 'root:wrstream', tmp]); os.replace(tmp, CONF)


def sh(*cmd):
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    return (r.stdout + r.stderr).strip()


def mask(text):
    for d in conf()['dests'].values():
        if d.get('key'): text = text.replace(d['key'], '****')
    return text


def running():
    return sh('systemctl', 'is-active', 'wr-stream') == 'active'


def status_text():
    c = conf(); live = [NAMES.get(p, p) for p in c['live'] if p in c['dests']]
    saved = ', '.join(f"{NAMES.get(p, p)} (…{d['key'][-4:]})" for p, d in c['dests'].items()) or 'none'
    load = open('/proc/loadavg').read().split()[:3]
    vol = load_env(STREAM_ENV).get('MUSIC_VOL', '?')
    tracks = len([f for f in os.listdir('/opt/wr-stream/music') if re.search(r'\.(mp3|m4a|ogg|flac|wav)$', f, re.I)])
    return (f"{'🔴 LIVE' if running() and live else '⚫ OFF'}"
            f"{' on ' + ', '.join(live) if running() and live else ''}\n"
            f"Keys saved: {saved}\nGo-live list: {', '.join(live) or 'none'}\n"
            f"CPU load: {' '.join(load)} (of {os.cpu_count()} cores)\nMusic: {tracks} tracks at volume {vol}")


HELP = """War Room stream control

/status — live or not, where, CPU, music
/live x kick — go live on these (any of: x kick twitch youtube custom)
/live — go live on the saved go-live list
/stop — stop the stream
/restart — restart everything (page + stream)
/key x <server url> <stream key> — save X (also kick, custom)
/key twitch <stream key> — save Twitch (also youtube)
/keys — which platforms have keys saved
/remove kick — forget a platform's key
/volume 0.15 — lofi volume (0 to 1)
/shot — screenshot of the stream
/logs — last lines of the stream log

Messages with keys are deleted as soon as they're saved."""


def platform(word):
    p = (word or '').lower().lstrip('/')
    return ALIASES.get(p, p) if ALIASES.get(p, p) in NAMES else None


def handle(msg):
    chat = msg['chat']['id']; uid = msg.get('from', {}).get('id'); text = (msg.get('text') or '').strip()
    if msg['chat'].get('type') != 'private': return
    reply = lambda t: tg('sendMessage', chat_id=chat, text=t, disable_web_page_preview='true')
    if uid not in ADMINS:
        return reply(f'Not allowed. Your Telegram id is {uid}; add it to ADMIN_IDS in {ENV} on the VPS.')
    parts = text.split(); cmd = parts[0].split('@')[0].lower() if parts else ''
    args = parts[1:]

    if cmd in ('/start', '/help'): return reply(HELP)
    if cmd == '/status': return reply(status_text())

    if cmd == '/key':
        tg('deleteMessage', chat_id=chat, message_id=msg['message_id'])   # the key never stays in the chat
        p = platform(args[0] if args else '')
        if not p: return reply('Usage: /key x <server url> <stream key>  or  /key twitch <stream key>')
        if p in DEFAULT_URL and len(args) == 2: url, key = DEFAULT_URL[p], args[1]
        elif len(args) == 3 and re.match(r'rtmps?://', args[1]): url, key = args[1], args[2]
        else: return reply(f'Usage: /key {p} ' + ('<stream key>' if p in DEFAULT_URL else '<server url rtmp(s)://…> <stream key>'))
        c = conf(); c['dests'][p] = {'url': url.rstrip('/'), 'key': key}; save(c)
        live_now = running() and p in c['live']
        if live_now: sh('systemctl', 'restart', 'wr-stream')
        return reply(f"🔑 {NAMES[p]} key saved (…{key[-4:]}) and your message deleted." + (' Restarted the stream with it.' if live_now else f' Go live with /live {p}'))

    if cmd == '/keys':
        c = conf(); return reply('\n'.join(f"{NAMES.get(p, p)}: {d['url']} (key …{d['key'][-4:]})" for p, d in c['dests'].items()) or 'No keys saved yet. /key to add one.')

    if cmd == '/remove':
        p = platform(args[0] if args else ''); c = conf()
        if not p or p not in c['dests']: return reply('Usage: /remove <platform with a saved key>')
        del c['dests'][p]; c['live'] = [x for x in c['live'] if x != p]; save(c)
        if running(): sh('systemctl', 'restart', 'wr-stream')
        return reply(f'{NAMES[p]} key removed.')

    if cmd == '/live':
        c = conf()
        if args:
            want = [platform(a) for a in args]
            bad = [a for a, p in zip(args, want) if not p]
            if bad: return reply('Unknown platform: ' + ', '.join(bad) + '. Use: x kick twitch youtube custom')
            c['live'] = list(dict.fromkeys(want))
        missing = [NAMES[p] for p in c['live'] if p not in c['dests']]
        if missing: return reply('No key saved for ' + ', '.join(missing) + '. Add it with /key first.')
        if not c['live']: return reply('Pick where: /live x kick twitch')
        save(c); sh('systemctl', 'restart', 'wr-stream'); time.sleep(12)
        return reply(('🔴 Going live on ' if running() else '⚠️ Could not start on ') + ', '.join(NAMES[p] for p in c['live']) + '. /status or /shot to check.')

    if cmd == '/stop':
        sh('systemctl', 'stop', 'wr-stream'); return reply('⚫ Stream stopped. /live to start again.')
    if cmd == '/restart':
        sh('systemctl', 'restart', 'wr-stream'); return reply('🔄 Restarting (about 20 s).')

    if cmd == '/volume':
        if not args or not re.fullmatch(r'(0(\.\d+)?|1(\.0+)?)', args[0]): return reply('Usage: /volume 0.15  (0 to 1)')
        sh('sed', '-i', f's/^MUSIC_VOL=.*/MUSIC_VOL={args[0]}/', STREAM_ENV)
        if running(): sh('systemctl', 'restart', 'wr-stream')
        return reply(f'🎵 Music volume {args[0]}' + (' (restarting to apply)' if running() else ''))

    if cmd == '/shot':
        if not running(): return reply('The stream is off. /live to start it.')
        out = '/tmp/wr-shot.jpg'
        sh('sudo', '-u', 'wrstream', 'env', 'DISPLAY=:99', 'ffmpeg', '-loglevel', 'error', '-y', '-f', 'x11grab', '-video_size', '1920x1080',
           '-i', ':99', '-frames:v', '1', '-q:v', '4', out)
        if os.path.exists(out): send_photo(chat, out, 'What the stream shows right now'); os.remove(out)
        else: reply('Could not grab a screenshot.')
        return

    if cmd == '/logs':
        return reply(mask(sh('journalctl', '-u', 'wr-stream', '-n', '25', '--no-pager', '-o', 'cat'))[-3500:] or 'No log lines yet.')

    return reply('Unknown command. /help')


def main():
    if not TOKEN or not ADMINS:
        print(f'set TG_TOKEN and ADMIN_IDS in {ENV}'); time.sleep(60); return
    tg('setMyCommands', commands=[{'command': c, 'description': d} for c, d in [
        ('status', 'live or not, where, CPU'), ('live', 'go live: /live x kick'), ('stop', 'stop the stream'),
        ('restart', 'restart page + stream'), ('key', 'save a stream key'), ('keys', 'saved platforms'),
        ('remove', 'forget a platform key'), ('volume', 'lofi volume 0-1'), ('shot', 'screenshot'), ('logs', 'stream log'), ('help', 'all commands')]])
    offset = None
    while True:
        r = tg('getUpdates', timeout=50, **({'offset': offset} if offset else {}), allowed_updates=['message'])
        for u in r.get('result', []):
            offset = u['update_id'] + 1
            if 'message' in u:
                try: handle(u['message'])
                except Exception as e: print('handle failed:', mask(str(e)))
        if not r: time.sleep(5)


if __name__ == '__main__':
    main()
