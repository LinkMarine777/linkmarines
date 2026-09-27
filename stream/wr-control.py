#!/usr/bin/env python3
"""War Room stream control bot (runs on the stream VPS).

A separate Telegram bot that long-polls Telegram (outbound HTTPS only, no open ports) and controls the
wr-stream service: pick destinations, save stream keys, start/stop, screenshots, logs, music volume.
Stream keys go Telegram -> this server only, and the message that carried a key is deleted right away.
Only Telegram user ids in ADMIN_IDS (/etc/wr-control.env) are obeyed, in private chats.
"""
import json, os, re, subprocess, threading, time, urllib.parse, urllib.request, uuid

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


MUSIC = '/opt/wr-stream/music'
AUDIO_RE = re.compile(r'\.(mp3|m4a|ogg|opus|flac|wav)$', re.I)


def music_files():
    return sorted(f for f in os.listdir(MUSIC) if AUDIO_RE.search(f))


# Public-domain (CC0) lofi by HoliznaCC0 on the Free Music Archive: free to stream anywhere, no credit needed, no DRM
DEFAULT_LOFI = 'https://freemusicarchive.org/music/holiznacc0/public-domain-lofi/'
UA = {'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) war-room-stream'}


def fetch(url, timeout=60):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r: return r.read()


def fma_tracks(url):
    """Every track on a Free Music Archive album/artist page as (title, direct mp3 url)."""
    import html as H
    s = H.unescape(fetch(url).decode('utf-8', 'replace'))
    out = {}
    for m in re.finditer(r'"title":"((?:[^"\\]|\\.)*)"[^{}]*?"fileUrl":"([^"]+)"', s):
        u = m[2].replace('\\/', '/')
        if u.endswith('.mp3'): out[u] = json.loads('"' + m[1] + '"')
    return [(t, u) for u, t in out.items()]


def safe_name(title, url):
    base = re.sub(r'[^A-Za-z0-9._-]+', '_', title).strip('_')[:70] or 'track'
    return f"{base}-{uuid.uuid5(uuid.NAMESPACE_URL, url).hex[:8]}.mp3"


def add_music(chat, link, quiet=False):
    """Add audio from a link to the rotation: Free Music Archive pages and direct .mp3 links are downloaded directly;
    anything else goes through yt-dlp. Then restart so the new playlist is picked up."""
    before, note = set(music_files()), ''
    try:
        if 'freemusicarchive.org' in link or link.lower().split('?')[0].endswith('.mp3'):
            tracks = fma_tracks(link) if 'freemusicarchive.org' in link else [(link.rsplit('/', 1)[-1].rsplit('.', 1)[0], link)]
            if not tracks: note = 'No tracks found on that page.'
            for title, u in tracks[:80]:
                path = os.path.join(MUSIC, safe_name(title, u))
                if os.path.exists(path): continue
                try:
                    data = fetch(u, timeout=300)
                    if len(data) > 100000: open(path, 'wb').write(data)
                except Exception as e: note = f'{title}: {e}'
        else:
            subprocess.run(['/usr/local/bin/yt-dlp', '-U'], capture_output=True, timeout=120)   # sites change often; stay current
            r = subprocess.run(['/usr/local/bin/yt-dlp', '-x', '--audio-format', 'mp3', '--audio-quality', '5', '--restrict-filenames', '--no-overwrites',
                                '--playlist-end', '40', '--match-filter', 'duration < 10800', '--ignore-errors', '--no-progress',
                                '-o', MUSIC + '/%(title).80B-%(id)s.%(ext)s', link], capture_output=True, text=True, timeout=3 * 3600)
            lines = [l for l in (r.stderr + r.stdout).splitlines() if l.strip()]
            errs = [l for l in lines if 'ERROR' in l]
            note = (errs or lines or [''])[-1][:300]
            if 'DRM' in note: note += '\n(SoundCloud/Spotify-style DRM can\'t be downloaded: use /music lofi or a Free Music Archive link.)'
    except Exception as e:
        note = str(e)[:300]
    subprocess.run(['chown', '-R', 'wrstream:wrstream', MUSIC])
    added = sorted(set(music_files()) - before)
    if added: reload_music()
    if quiet: return
    if added:
        tg('sendMessage', chat_id=chat, text=f'🎵 Added {len(added)} track(s); {len(music_files())} in the rotation now, playing on a fresh shuffle.')
    else:
        tg('sendMessage', chat_id=chat, text='⚠️ Nothing was added.' + (f'\n{note}' if note else '') +
           '\nEasiest: /music lofi (52 public-domain lofi tracks). Free Music Archive links and direct .mp3 links also work; YouTube usually blocks servers.')


def reload_music():
    """Restart only the lofi player (new tracks / volume / shuffle); the stream itself keeps going."""
    subprocess.run(['pkill', '-f', 'ffmpeg.*wr-lofi'])


def running():
    return sh('systemctl', 'is-active', 'wr-stream') == 'active'


PROGRESS = '/opt/wr-stream/.run/progress'


def sending():
    """(True, mbps) when ffmpeg is actually pushing data right now, else (False, last error line from the log)."""
    try:
        age = time.time() - os.path.getmtime(PROGRESS)
        tail = open(PROGRESS).read().splitlines()[-14:]
        kv = dict(l.split('=', 1) for l in tail if '=' in l)
        if age < 10 and kv.get('progress') == 'continue':
            m = re.match(r'([\d.]+)kbits', kv.get('bitrate', ''))
            return True, (float(m[1]) / 1000 if m else None)
    except Exception:
        pass
    log = sh('journalctl', '-u', 'wr-stream', '-n', '60', '--no-pager', '-o', 'cat').splitlines()
    err = [l for l in log if re.search(r'error|fail|refused|denied|timed out|invalid|not found|unauthor|forbidden|reset', l, re.I)]
    return False, mask(err[-1])[:300] if err else None


def status_text():
    c = conf(); live = [NAMES.get(p, p) for p in c['live'] if p in c['dests']]
    saved = ', '.join(f"{NAMES.get(p, p)} (…{d['key'][-4:]})" for p, d in c['dests'].items()) or 'none'
    load = open('/proc/loadavg').read().split()[:3]
    vol = load_env(STREAM_ENV).get('MUSIC_VOL', '?')
    tracks = len(music_files())
    on = running() and live
    ok, info = sending() if on else (False, None)
    head = ('🔴 LIVE on ' + ', '.join(live) + (f' · sending {info:.1f} Mbps' if ok and info else ' · sending') if on and ok
            else '⚠️ NOT CONNECTED to ' + ', '.join(live) + ('\nLast error: ' + info if info else '\n(starting up or retrying; check again in 20 s)') if on
            else '⚫ OFF')
    return (f"{head}\n"
            f"Keys saved: {saved}\nGo-live list: {', '.join(live) or 'none'}\n"
            f"CPU load: {' '.join(load)} (of {os.cpu_count()} cores)\nMusic: {tracks} tracks at volume {vol}"
            + (' · ▶ playing' if subprocess.run(['pgrep', '-f', 'ffmpeg.*wr-lofi'], capture_output=True).returncode == 0 else ' · ⏸ not playing' if running() and tracks else ''))


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
/music lofi — add 52 public-domain lofi tracks (free to stream anywhere)
/music <link> — add a Free Music Archive page or .mp3 link
/music — what's in the rotation · /music clear — empty it
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
        return reply(f'Your Telegram id is {uid}.\n\nTo let this account control the stream, run this on the VPS:\n  wr-stream admin {uid}')
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
        url = url.rstrip('/')
        if p == 'kick' and not url.endswith('/app'): url += '/app'   # Kick (Amazon IVS) ingest lives under /app
        c = conf(); c['dests'][p] = {'url': url, 'key': key}; save(c)
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
        time.sleep(10); ok, info = sending()
        where = ', '.join(NAMES[p] for p in c['live'])
        return reply(f'🔴 Live on {where}' + (f', sending {info:.1f} Mbps.' if ok and info else '.') if ok
                     else f'⚠️ Started, but nothing is reaching {where} yet.' + (f'\nLast error: {info}' if info else '') + '\nCheck the server URL and key (/keys), then /status again.')

    if cmd == '/stop':
        sh('systemctl', 'stop', 'wr-stream'); return reply('⚫ Stream stopped. /live to start again.')
    if cmd == '/restart':
        sh('systemctl', 'restart', 'wr-stream'); return reply('🔄 Restarting (about 20 s).')

    if cmd == '/volume':
        if not args or not re.fullmatch(r'(0(\.\d+)?|1(\.0+)?)', args[0]): return reply('Usage: /volume 0.15  (0 to 1)')
        sh('sed', '-i', f's/^MUSIC_VOL=.*/MUSIC_VOL={args[0]}/', STREAM_ENV)
        reload_music()
        return reply(f'🎵 Music volume {args[0]} (applied now, the stream keeps running)')

    if cmd == '/shot':
        if not running(): return reply('The stream is off. /live to start it.')
        out = '/tmp/wr-shot.jpg'
        sh('sudo', '-u', 'wrstream', 'env', 'DISPLAY=:99', 'ffmpeg', '-loglevel', 'error', '-y', '-f', 'x11grab', '-video_size', '1920x1080',
           '-i', ':99', '-frames:v', '1', '-q:v', '4', out)
        if os.path.exists(out): send_photo(chat, out, 'What the stream shows right now'); os.remove(out)
        else: reply('Could not grab a screenshot.')
        return

    if cmd == '/music':
        if not args:
            fs = music_files()
            return reply(f'🎵 {len(fs)} tracks in the rotation' + (':\n' + '\n'.join('· ' + f.rsplit('.', 1)[0][:60] for f in fs[:20]) + ('\n…' if len(fs) > 20 else '') if fs else
                         '.\nAdd some: /music lofi (52 public-domain lofi tracks, free to stream anywhere)'))
        if args[0].lower() == 'clear':
            for f in music_files(): os.remove(os.path.join(MUSIC, f))
            reload_music()
            return reply('🎵 Rotation emptied.')
        link = DEFAULT_LOFI if args[0].lower() in ('lofi', 'default') else args[0]
        if not re.match(r'https?://', link): return reply('Usage: /music lofi  or  /music <Free Music Archive / .mp3 link>')
        reply('⏳ Downloading' + (' HoliznaCC0 "Public Domain Lofi" (52 tracks, a few minutes)' if link == DEFAULT_LOFI else ' the audio from that link') + '. I\'ll message you when it\'s in the rotation.')
        threading.Thread(target=add_music, args=(chat, link), daemon=True).start()
        return

    if cmd == '/logs':
        return reply(mask(sh('journalctl', '-u', 'wr-stream', '-n', '25', '--no-pager', '-o', 'cat'))[-3500:] or 'No log lines yet.')

    return reply('Unknown command. /help')


def main():
    if not TOKEN:
        print(f'set TG_TOKEN in {ENV}'); time.sleep(60); return
    # with no ADMIN_IDS yet it still answers, telling each person their id and how to authorize it
    tg('setMyCommands', commands=[{'command': c, 'description': d} for c, d in [
        ('status', 'live or not, where, CPU'), ('live', 'go live: /live x kick'), ('stop', 'stop the stream'),
        ('restart', 'restart page + stream'), ('key', 'save a stream key'), ('keys', 'saved platforms'),
        ('remove', 'forget a platform key'), ('volume', 'lofi volume 0-1'), ('music', 'lofi: /music lofi'), ('shot', 'screenshot'), ('logs', 'stream log'), ('help', 'all commands')]])
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
    import sys
    if '--seed' in sys.argv:   # setup: fill an empty rotation with the public-domain lofi album
        if not music_files(): add_music(None, DEFAULT_LOFI, quiet=True)
    else:
        main()
