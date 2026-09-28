#!/usr/bin/env bash
# War Room 24/7 stream: Terminal 1.1 in a headless Chrome (1920x1080) + its sounds + a quiet lofi loop -> one or more
# RTMP destinations at once, controlled from a Telegram bot that runs here (outbound only: no open ports).
# Ubuntu/Debian VPS, run as root:  curl -fsSL https://raw.githubusercontent.com/LinkMarine777/linkmarines/main/stream/setup.sh | sudo bash
# Re-running is safe: it updates the scripts, keeps your config, and never takes a running stream off air (changes to
# the stream itself apply on the next /restart or /upgrade). Stream keys stay on this server only.
# Just update the scripts (no packages, no questions):  curl -fsSL .../stream/setup.sh | sudo bash -s update
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run as root (sudo)"; exit 1; }
[ "$(uname -m)" = x86_64 ] || { echo "this script needs an x86_64 (amd64) VPS"; exit 1; }

APP=/opt/wr-stream; ENV=/etc/wr-stream.env; CONF=/etc/wr-stream.json; CENV=/etc/wr-control.env; USERN=wrstream
RAW=https://raw.githubusercontent.com/LinkMarine777/linkmarines/main/stream
MODE=${1:-full}
if [ "$MODE" = full ]; then
echo "== installing packages (a few minutes)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq python3 xvfb ffmpeg pulseaudio pulseaudio-utils fonts-noto-color-emoji fonts-dejavu-core fonts-liberation curl ca-certificates >/dev/null
if ! command -v google-chrome >/dev/null; then
  curl -fsSL -o /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
  apt-get install -y -qq /tmp/chrome.deb >/dev/null; rm -f /tmp/chrome.deb
fi

id $USERN >/dev/null 2>&1 || useradd -r -m -d $APP -s /usr/sbin/nologin $USERN
mkdir -p $APP/music $APP/chrome; chown -R $USERN:$USERN $APP

# ---- stream settings (resolution picked from the CPU count; edit /etc/wr-stream.env to change)
if [ ! -f $ENV ]; then
  CORES=$(nproc); RES=1920x1080; BITRATE=4500k
  [ "$CORES" -lt 4 ] && { RES=1280x720; BITRATE=3000k; }
  printf 'PAGE="https://linkmarines.vercel.app/terminal/?obs"\nOUT_RES=%s\nBITRATE=%s\nFPS=30\nMUSIC_VOL=0.15\n' "$RES" "$BITRATE" > $ENV
  echo "stream output: $RES @ $BITRATE ($CORES vCPU)"
fi
chown root:$USERN $ENV; chmod 640 $ENV

# ---- destinations + keys live in /etc/wr-stream.json (set from Telegram); a key saved by the first setup version carries over
python3 - "$ENV" "$CONF" <<'PY'
import json, os, re, sys
env, conf = sys.argv[1], sys.argv[2]
c = json.load(open(conf)) if os.path.exists(conf) else {'dests': {}, 'live': []}
lines = open(env).read().splitlines(); kv = {}
for l in lines:
    m = re.match(r'(RTMP_URL|STREAM_KEY)="?(.*?)"?$', l)
    if m: kv[m[1]] = m[2]
if kv.get('RTMP_URL') and kv.get('STREAM_KEY'):
    u = kv['RTMP_URL']
    p = ('twitch' if 'twitch' in u else 'youtube' if 'youtube' in u else 'kick' if ('kick' in u or 'live-video.net' in u)
         else 'x' if ('pscp' in u or 'x.com' in u or 'twitter' in u) else 'custom')
    c['dests'][p] = {'url': u.rstrip('/'), 'key': kv['STREAM_KEY']}
    c['live'] = c['live'] or [p]
    open(env, 'w').write('\n'.join(l for l in lines if not re.match(r'(RTMP_URL|STREAM_KEY)=', l)) + '\n')
    print('moved your saved', p, 'key into', conf)
json.dump(c, open(conf, 'w'), indent=1)
PY
chown root:$USERN $CONF; chmod 640 $CONF

# ---- the Telegram control bot (a new bot from @BotFather, separate from the War Room approval bot)
if [ ! -f $CENV ]; then
  echo; echo "== Telegram control bot: create one with @BotFather (/newbot), then paste its token here."
  echo "   (Enter to skip; re-run this script later to add it)"
  read -rsp "control bot token (hidden): " TGT </dev/tty; echo
  if [ -n "$TGT" ]; then
    read -rp "your Telegram user id(s), comma separated (Enter if you don't know it: the bot will tell you): " ADM </dev/tty
    umask 077; printf 'TG_TOKEN="%s"\nADMIN_IDS="%s"\n' "$TGT" "$ADM" > $CENV; chmod 600 $CENV; umask 022
  fi
fi
fi   # end of first-time setup; everything below also runs for 'update'

mkdir -p /opt/wr-control
curl -fsSL -o /opt/wr-control/wr-control.py "$RAW/wr-control.py"; chmod 700 /opt/wr-control/wr-control.py
curl -fsSL -o $APP/wr-relays.py.new "$RAW/wr-relays.py" && mv $APP/wr-relays.py.new $APP/wr-relays.py; chmod 755 $APP/wr-relays.py
# the stream's Chrome: run.sh calls google-chrome and /usr/local/bin comes first in PATH. For the wrstream user this reads
# the page from /etc/wr-stream.env at every launch and opens DevTools on 127.0.0.1 only, so /page can switch it in place.
cat > /usr/local/bin/google-chrome <<'CHR'
#!/usr/bin/env bash
REAL=/usr/bin/google-chrome
[ "$(id -un)" = wrstream ] || exec "$REAL" "$@"
source /etc/wr-stream.env
args=(); for a in "$@"; do case "$a" in http://*|https://*) ;; *) args+=("$a");; esac; done
exec "$REAL" "${args[@]}" --remote-debugging-port=9222 "$PAGE"
CHR
chmod 755 /usr/local/bin/google-chrome
# yt-dlp for /music <link> (the official build; it updates itself before each download)
curl -fsSL -o /usr/local/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp; chmod 755 /usr/local/bin/yt-dlp

# ---- the runner: virtual screen + audio + chrome + music + sender, each restarted if it dies
# (written next to the running copy and swapped in, so a live stream never reads a half-written file)
cat > $APP/run.sh.new <<'RUN'
#!/usr/bin/env bash
set -u
source /etc/wr-stream.env
export DISPLAY=:99 XDG_RUNTIME_DIR=/opt/wr-stream/.run HOME=/opt/wr-stream
mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
cleanup(){ kill 0 2>/dev/null; }; trap cleanup EXIT

Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp -ac & sleep 2
pulseaudio --kill 2>/dev/null; pulseaudio --start --exit-idle-time=-1 --disallow-exit
pactl load-module module-null-sink sink_name=wr sink_properties=device.description=wr >/dev/null
pactl set-default-sink wr

# chrome: full screen on the terminal, autoplay allowed (alert sounds + TTS need no click); relaunched if it ever exits
( while true; do
    source /etc/wr-stream.env
    google-chrome --kiosk --start-fullscreen --window-position=0,0 --window-size=1920,1080 --force-device-scale-factor=1 \
      --autoplay-policy=no-user-gesture-required --no-first-run --no-default-browser-check --noerrdialogs --disable-infobars \
      --disable-session-crashed-bubble --disable-features=Translate,MediaRouter --disable-dev-shm-usage --hide-scrollbars \
      --user-data-dir=/opt/wr-stream/chrome --password-store=basic "$PAGE" >/dev/null 2>&1
    sleep 3
  done ) &

sleep 8
# lofi: its own player into the same audio mix as the page. Each pass is a fresh shuffle of /opt/wr-stream/music;
# when it ends (or is killed to pick up new tracks / volume), the loop starts the next pass. Never stops.
mk_playlist(){ find /opt/wr-stream/music -maxdepth 1 -type f \( -iname '*.mp3' -o -iname '*.m4a' -o -iname '*.ogg' -o -iname '*.opus' -o -iname '*.flac' -o -iname '*.wav' \) | shuf | sed "s/'/'\\\\''/g; s/.*/file '&'/" > /opt/wr-stream/.playlist; }
( while true; do
    source /etc/wr-stream.env; mk_playlist
    if [ -s /opt/wr-stream/.playlist ]; then
      ffmpeg -hide_banner -loglevel error -nostdin -re -f concat -safe 0 -i /opt/wr-stream/.playlist -af "volume=${MUSIC_VOL}" \
        -ac 2 -ar 44100 -f pulse -device wr wr-lofi
    else sleep 30; fi
    sleep 1
  done ) &

# the sender: one encoder, then one relay per live platform, each started and stopped on its own (see wr-relays.py)
python3 /opt/wr-stream/wr-relays.py
RUN
chmod 755 $APP/run.sh.new; chown $USERN:$USERN $APP/run.sh.new; mv $APP/run.sh.new $APP/run.sh

cat > /etc/systemd/system/wr-stream.service <<UNIT
[Unit]
Description=War Room 24/7 stream (Terminal 1.1 -> RTMP)
After=network-online.target
Wants=network-online.target
[Service]
User=$USERN
ExecStart=$APP/run.sh
Restart=always
RestartSec=5
KillMode=control-group
[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/systemd/system/wr-control.service <<'UNIT'
[Unit]
Description=War Room stream control bot (Telegram)
After=network-online.target
Wants=network-online.target
[Service]
ExecStart=/usr/bin/python3 /opt/wr-control/wr-control.py
Restart=always
RestartSec=10
[Install]
WantedBy=multi-user.target
UNIT

# ---- control command on the VPS
cat > /usr/local/bin/wr-stream <<'CTL'
#!/usr/bin/env bash
E=/etc/wr-stream.env
case "${1:-status}" in
  start|stop|restart|status) sudo systemctl "$1" wr-stream --no-pager ;;
  logs) sudo journalctl -u wr-stream -f -n 50 ;;
  volume) [ -n "${2:-}" ] || { grep MUSIC_VOL $E; exit; }; sudo sed -i "s/^MUSIC_VOL=.*/MUSIC_VOL=$2/" $E; sudo pkill -f 'ffmpeg.*wr-lofi'; echo "music volume $2 (0.0-1.0), applied now";;
  key|live|page) echo "keys, platforms and the page are set from the Telegram control bot: /key, /live, /off, /page (see /help there)";;
  bot) sudo systemctl status wr-control --no-pager; sudo journalctl -u wr-control -n 20 --no-pager -o cat;;
  admin) [[ "${2:-}" =~ ^[0-9]+$ ]] || { echo "usage: wr-stream admin <telegram user id>"; sudo grep ADMIN_IDS /etc/wr-control.env; exit 1; }
    C=/etc/wr-control.env; cur=$(sudo sed -n 's/^ADMIN_IDS="\(.*\)"/\1/p' $C)
    sudo sed -i "s/^ADMIN_IDS=.*/ADMIN_IDS=\"${cur:+$cur,}$2\"/" $C; sudo systemctl restart wr-control; echo "added $2: send /help to the bot";;
  music) ls -1 /opt/wr-stream/music; echo "(add files there, then: wr-stream music-reload)";;
  music-reload) sudo pkill -f 'ffmpeg.*wr-lofi'; echo "music player restarted with a fresh shuffle";;
  shot) sudo -u wrstream env DISPLAY=:99 ffmpeg -loglevel error -y -f x11grab -video_size 1920x1080 -i :99 -frames:v 1 /tmp/wr-shot.png && echo "saved /tmp/wr-shot.png";;
  *) echo "wr-stream start|stop|restart|status|logs|volume [0.15]|music|shot|bot|admin <id>";;
esac
CTL
chmod 755 /usr/local/bin/wr-stream

# the real-time listener (wr-live) was dropped: remove it if an earlier version installed it
systemctl disable --now wr-live >/dev/null 2>&1 || true
rm -rf /etc/systemd/system/wr-live.service /opt/wr-live /etc/wr-live.env /etc/opt/chrome/policies/managed/wr-live.json
systemctl daemon-reload
systemctl enable wr-stream wr-control >/dev/null 2>&1
systemctl restart wr-control   # the Telegram bot only; the stream is never interrupted by setup
if systemctl is-active --quiet wr-stream; then
  pgrep -f wr-relays.py >/dev/null || echo "   The stream kept running. Send /upgrade to the Telegram bot when it's a good moment (about 15 s off air, once)."
else systemctl start wr-stream; fi
# empty music folder: fetch the public-domain lofi album in the background (the stream restarts to include it when done)
[ "$MODE" = full ] && [ -z "$(ls -A $APP/music 2>/dev/null)" ] && { nohup python3 /opt/wr-control/wr-control.py --seed >/dev/null 2>&1 & echo "downloading 52 public-domain lofi tracks in the background"; }
echo
echo "== done. The terminal page is up; it goes on air once you pick a destination."
echo "   In Telegram, open your control bot and send /help  (then /key ... and /live ...)"
echo "   On the VPS: wr-stream status | logs | shot | volume 0.15 | restart | bot"
