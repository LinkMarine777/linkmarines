#!/usr/bin/env python3
"""War Room stream sender (runs inside the wr-stream service, as the wrstream user).

One encoder turns the screen + audio into video once and hands it to local-only UDP ports (127.0.0.1, one per
platform). Each platform that's live gets its own small relay that copies that video to its RTMP server without
re-encoding. So going live or offline on one platform, or changing its key, starts or stops only that relay: the
other platforms keep streaming untouched. /etc/wr-stream.json (written by the Telegram control bot) says which
platforms are live; this loop checks it every 2 s.
"""
import ctypes, hashlib, json, os, re, signal, subprocess, sys, threading, time

RUN = '/opt/wr-stream/.run'
CONF = '/etc/wr-stream.json'
ENV = '/etc/wr-stream.env'
SLOTS = {'x': 5001, 'kick': 5002, 'twitch': 5003, 'youtube': 5004, 'custom': 5005}   # platform -> local UDP port


def load_env():
    out = {}
    for line in open(ENV):
        m = re.match(r'\s*([A-Z_]+)=(.*)', line)
        if m: out[m[1]] = m[2].strip().strip('"')
    return out


def conf():
    try: return json.load(open(CONF))
    except Exception: return {'dests': {}, 'live': []}


def target(p, d):
    u = d['url'].rstrip('/')
    if p == 'kick' and not u.endswith('/app'): u += '/app'   # Kick (Amazon IVS) ingest lives under /app
    return u + '/' + d['key']


KEYS = set()


def log(*a):
    s = ' '.join(str(x) for x in a)
    for k in KEYS: s = s.replace(k, '****')
    print(s, flush=True)


def pipe_log(proc, tag):
    """Relay each ffmpeg's warnings to the journal with its platform tag (keys masked); /status reads these."""
    for line in proc.stderr:
        line = line.strip()
        if line: log(f'[{tag}] {line}')


def die_with_parent():
    """An ffmpeg never outlives this loop (no stray encoder still holding a port after a crash)."""
    try: ctypes.CDLL('libc.so.6').prctl(1, signal.SIGTERM)   # PR_SET_PDEATHSIG
    except Exception: pass


def spawn(cmd, tag):
    p = subprocess.Popen(cmd, preexec_fn=die_with_parent, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, errors='replace')
    threading.Thread(target=pipe_log, args=(p, tag), daemon=True).start()
    return p


def stop(proc):
    if proc and proc.poll() is None:
        proc.terminate()
        try: proc.wait(5)
        except subprocess.TimeoutExpired: proc.kill()


def encoder_cmd():
    e = load_env()
    fps, res, br = e.get('FPS', '30'), e.get('OUT_RES', '1920x1080'), e.get('BITRATE', '4500k')
    v = f'[0:v]fps={fps}[v]' if res == '1920x1080' else f'[0:v]fps={fps},scale={res.replace("x", ":")}:flags=bicubic[v]'
    outs = '|'.join(f'[f=mpegts:onfail=ignore]udp://127.0.0.1:{port}?pkt_size=1316' for port in SLOTS.values())
    return ['ffmpeg', '-hide_banner', '-loglevel', 'warning', '-nostdin',
            '-thread_queue_size', '1024', '-f', 'x11grab', '-video_size', '1920x1080', '-framerate', fps, '-draw_mouse', '0', '-i', ':99',
            '-thread_queue_size', '1024', '-f', 'pulse', '-i', 'wr.monitor',   # page sounds + lofi, already mixed by PulseAudio
            '-filter_complex', f'{v};[1:a]aresample=44100,alimiter=limit=0.95[a]', '-map', '[v]', '-map', '[a]',
            '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-b:v', br, '-maxrate', br, '-bufsize', br,
            '-pix_fmt', 'yuv420p', '-g', str(int(fps) * 2), '-c:a', 'aac', '-b:a', '160k', '-ar', '44100',
            '-progress', f'{RUN}/progress', '-f', 'tee', outs]


def relay_cmd(p, dest):
    return ['ffmpeg', '-hide_banner', '-loglevel', 'warning', '-nostdin', '-fflags', '+genpts',
            '-i', f'udp://127.0.0.1:{SLOTS[p]}?fifo_size=1000000&overrun_nonfatal=1&timeout=15000000',
            '-c', 'copy', '-bsf:a', 'aac_adtstoasc', '-progress', f'{RUN}/progress-{p}', '-f', 'flv', dest]


def main():
    os.makedirs(RUN, exist_ok=True)
    enc, enc_next = None, 0
    relays, next_try = {}, {}   # platform -> (process, fingerprint of its url+key)
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    try:
        while True:
            c = conf(); now = time.time()
            want = {p: target(p, c['dests'][p]) for p in c.get('live', []) if p in c.get('dests', {}) and p in SLOTS}
            KEYS.update(d.get('key', '') for d in c.get('dests', {}).values() if d.get('key'))
            # the encoder runs while at least one platform is live
            if want and (enc is None or enc.poll() is not None) and now >= enc_next:
                if enc is not None: log(f'[encoder] exited ({enc.returncode}), restarting')
                enc, enc_next = spawn(encoder_cmd(), 'encoder'), now + 5
            elif not want and enc is not None:
                stop(enc); enc = None; log('[encoder] off air')
            for p in SLOTS:
                fp = hashlib.sha256(want[p].encode()).hexdigest() if p in want else None
                r = relays.get(p)
                if r and (fp is None or r[1] != fp or r[0].poll() is not None):
                    if r[0].poll() is not None and fp == r[1]: log(f'[{p}] disconnected ({r[0].returncode}), reconnecting')
                    stop(r[0]); relays.pop(p)
                    if fp is None:
                        log(f'[{p}] offline')
                        try: os.remove(f'{RUN}/progress-{p}')
                        except FileNotFoundError: pass
                    r = None
                if fp and not r and now >= next_try.get(p, 0):
                    relays[p], next_try[p] = (spawn(relay_cmd(p, want[p]), p), fp), now + 5
                    log(f'[{p}] going live')
            time.sleep(2)
    finally:
        for r in relays.values(): stop(r[0])
        stop(enc)


if __name__ == '__main__':
    main()
