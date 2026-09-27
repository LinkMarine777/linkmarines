#!/usr/bin/env bash
# War Room 24/7 stream: Terminal 1.1 in a headless Chrome (1920x1080) + its sounds + a quiet lofi loop -> RTMP.
# Ubuntu/Debian VPS, run as root:  curl -fsSL https://raw.githubusercontent.com/LinkMarine777/linkmarines/main/stream/setup.sh | sudo bash
# Re-running is safe (it updates the scripts and keeps your config). Your stream key stays on this server only.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run as root (sudo)"; exit 1; }
[ "$(uname -m)" = x86_64 ] || { echo "this script needs an x86_64 (amd64) VPS"; exit 1; }

APP=/opt/wr-stream; ENV=/etc/wr-stream.env; USERN=wrstream
echo "== installing packages (a few minutes)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq xvfb ffmpeg pulseaudio pulseaudio-utils fonts-noto-color-emoji fonts-dejavu-core fonts-liberation curl ca-certificates >/dev/null
if ! command -v google-chrome >/dev/null; then
  curl -fsSL -o /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
  apt-get install -y -qq /tmp/chrome.deb >/dev/null; rm -f /tmp/chrome.deb
fi

id $USERN >/dev/null 2>&1 || useradd -r -m -d $APP -s /usr/sbin/nologin $USERN
mkdir -p $APP/music $APP/chrome; chown -R $USERN:$USERN $APP

# ---- config (asked once; edit later with: wr-stream key / wr-stream volume)
if [ ! -f $ENV ]; then
  echo; echo "== where should it stream?"
  echo "  1) X (Twitter)  2) Twitch  3) YouTube  4) Kick  5) other RTMP URL"
  read -rp "pick 1-5: " P </dev/tty
  case "$P" in
    1) read -rp "X 'Server URL' from Media Studio / Producer (rtmp://...): " URL </dev/tty ;;
    2) URL=rtmp://live.twitch.tv/app ;;
    3) URL=rtmp://a.rtmp.youtube.com/live2 ;;
    4) read -rp "Kick 'Stream URL' (rtmps://.../app): " URL </dev/tty ;;
    *) read -rp "RTMP server URL: " URL </dev/tty ;;
  esac
  read -rsp "stream key (hidden): " KEY </dev/tty; echo
  CORES=$(nproc); RES=1920x1080; BITRATE=4500k
  [ "$CORES" -lt 4 ] && { RES=1280x720; BITRATE=3000k; }
  umask 077
  cat > $ENV <<EOF
RTMP_URL="$URL"
STREAM_KEY="$KEY"
PAGE="https://linkmarines.vercel.app/terminal1.1/?obs"
OUT_RES=$RES
BITRATE=$BITRATE
FPS=30
MUSIC_VOL=0.15
EOF
  chown root:$USERN $ENV; chmod 640 $ENV   # readable by the stream service only
  echo "saved $ENV (output $RES @ $BITRATE on $CORES vCPU)"
fi

# ---- the runner: virtual screen + audio + chrome + ffmpeg, each restarted if it dies
cat > $APP/run.sh <<'RUN'
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
    google-chrome --kiosk --start-fullscreen --window-position=0,0 --window-size=1920,1080 --force-device-scale-factor=1 \
      --autoplay-policy=no-user-gesture-required --no-first-run --no-default-browser-check --noerrdialogs --disable-infobars \
      --disable-session-crashed-bubble --disable-features=Translate,MediaRouter --disable-dev-shm-usage --hide-scrollbars \
      --user-data-dir=/opt/wr-stream/chrome --password-store=basic "$PAGE" >/dev/null 2>&1
    sleep 3
  done ) &

sleep 8
# lofi: every mp3/m4a/ogg/flac/wav in /opt/wr-stream/music, shuffled, looped forever
mk_playlist(){ find /opt/wr-stream/music -maxdepth 1 -type f \( -iname '*.mp3' -o -iname '*.m4a' -o -iname '*.ogg' -o -iname '*.flac' -o -iname '*.wav' \) | shuf | sed "s/'/'\\\\''/g; s/.*/file '&'/" > /opt/wr-stream/.playlist; }

while true; do
  source /etc/wr-stream.env; mk_playlist
  [ "${OUT_RES}" = 1920x1080 ] && V="[0:v]fps=${FPS}[v]" || V="[0:v]fps=${FPS},scale=${OUT_RES/x/:}:flags=bicubic[v]"
  if [ -s /opt/wr-stream/.playlist ]; then
    IN_MUSIC=(-stream_loop -1 -f concat -safe 0 -i /opt/wr-stream/.playlist)
    AF="[1:a]aresample=44100,volume=1.0[s];[2:a]aresample=44100,volume=${MUSIC_VOL}[m];[s][m]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[a]"
  else IN_MUSIC=(); AF="[1:a]aresample=44100[a]"; fi
  ffmpeg -hide_banner -loglevel warning -thread_queue_size 1024 -f x11grab -video_size 1920x1080 -framerate "$FPS" -draw_mouse 0 -i :99 \
    -thread_queue_size 1024 -f pulse -i wr.monitor "${IN_MUSIC[@]}" \
    -filter_complex "$V;$AF" -map "[v]" -map "[a]" \
    -c:v libx264 -preset veryfast -tune zerolatency -b:v "$BITRATE" -maxrate "$BITRATE" -bufsize "$BITRATE" -pix_fmt yuv420p -g $((FPS*2)) \
    -c:a aac -b:a 160k -ar 44100 -f flv "${RTMP_URL%/}/${STREAM_KEY}"
  echo "ffmpeg exited ($?), reconnecting in 5 s"; sleep 5
done
RUN
chmod 755 $APP/run.sh; chown $USERN:$USERN $APP/run.sh

cat > /etc/systemd/system/wr-stream.service <<EOF
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
EOF

# ---- control command
cat > /usr/local/bin/wr-stream <<'CTL'
#!/usr/bin/env bash
E=/etc/wr-stream.env
case "${1:-status}" in
  start|stop|restart|status) sudo systemctl "$1" wr-stream --no-pager ;;
  logs) sudo journalctl -u wr-stream -f -n 50 ;;
  volume) [ -n "${2:-}" ] || { grep MUSIC_VOL $E; exit; }; sudo sed -i "s/^MUSIC_VOL=.*/MUSIC_VOL=$2/" $E; sudo systemctl restart wr-stream; echo "music volume $2 (0.0-1.0)";;
  key) read -rsp "new stream key (hidden): " K; echo; sudo sed -i "s|^STREAM_KEY=.*|STREAM_KEY=\"$K\"|" $E; sudo systemctl restart wr-stream; echo "saved";;
  music) ls -1 /opt/wr-stream/music; echo "(add files there, then: wr-stream restart)";;
  shot) sudo -u wrstream env DISPLAY=:99 ffmpeg -loglevel error -y -f x11grab -video_size 1920x1080 -i :99 -frames:v 1 /tmp/wr-shot.png && echo "saved /tmp/wr-shot.png";;
  *) echo "wr-stream start|stop|restart|status|logs|volume [0.15]|key|music|shot";;
esac
CTL
chmod 755 /usr/local/bin/wr-stream

systemctl daemon-reload
systemctl enable --now wr-stream >/dev/null
systemctl restart wr-stream
echo
echo "== done. the stream is starting (give it ~20 s)."
echo "   wr-stream status | logs | shot | volume 0.15 | key | restart"
echo "   lofi: copy tracks you're licensed to stream into /opt/wr-stream/music, then: wr-stream restart"
