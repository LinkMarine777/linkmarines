#!/usr/bin/env bash
# Terminal 7's data jobs on their own VPS (Ubuntu/Debian, any size: they mostly wait on the network). Outbound only: no ports
# are opened. Run as root:
#   curl -fsSL https://raw.githubusercontent.com/LinkMarine777/linkmarines/main/vps/setup.sh | sudo bash
# Re-running is safe: it keeps the keys in /etc/t7.env and restarts the jobs on the latest code.
#   jobs (one service each, restarted if they stop):  kick (the bot's stonkfun work, every 45 s) · payouts (stonkfun's payout
#   feed for the wallet X-Ray) · launches (launch radar, a pass every ~2 min) · whales (whale radar: a full pass every 30 min,
#   fast passes in between). Each hands its files to the bot (POST /ingest with this server's key); the GitHub jobs keep
#   running as the backup and git record.
# Root is used only by this script, which you run. The jobs run as the locked-down user t7 (no sudo, can't gain privileges, can
# write only to /opt/t7) and keep their own code up to date: each pulls the repo between passes and restarts itself when it
# changed. Nothing from the repo ever runs as root after this.
# Check on it:  t7 status · t7 logs whales · t7 restart
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run as root (sudo)"; exit 1; }
APP=/opt/t7; ENV=/etc/t7.env; REPO=https://github.com/LinkMarine777/linkmarines
echo "== packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq && apt-get install -y -qq git python3 curl ca-certificates >/dev/null
id t7 >/dev/null 2>&1 || useradd -r -m -d $APP -s /usr/sbin/nologin t7
echo "== code and data"
if [ -d $APP/site/.git ]; then runuser -u t7 -- git -C $APP/site fetch -q --depth 1 origin main && runuser -u t7 -- git -C $APP/site reset -q --hard FETCH_HEAD
else runuser -u t7 -- git clone -q --depth 1 $REPO $APP/site; fi
for j in launches whales; do   # each job its own copy of the data branch (they refresh it before every pass)
  [ -d $APP/data-$j/.git ] || runuser -u t7 -- git clone -q --depth 1 --single-branch --branch data $REPO $APP/data-$j
done
if [ ! -f $ENV ]; then
  KEY=$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 48)
  HK=""   # (the whale radar runs on the free public RPC; see vps/run.sh)
  printf 'VPS_KEY=%s\nHELIUS_KEY=%s\n' "$KEY" "$HK" > $ENV
fi
chmod 600 $ENV
echo "== services"
cat > /etc/systemd/system/t7@.service <<'UNIT'
[Unit]
Description=Terminal 7 job %i
After=network-online.target
Wants=network-online.target
[Service]
User=t7
EnvironmentFile=/etc/t7.env
ExecStart=/bin/bash /opt/t7/site/vps/run.sh %i
Restart=always
RestartSec=20
Nice=10
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/opt/t7
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
CapabilityBoundingSet=
[Install]
WantedBy=multi-user.target
UNIT
# (an earlier version had a root timer pull the code: gone, the jobs update themselves as t7)
systemctl disable --now t7-update.timer >/dev/null 2>&1 || true; rm -f /etc/systemd/system/t7-update.service /etc/systemd/system/t7-update.timer
cat > /usr/local/bin/t7 <<'CMD'
#!/bin/bash
J="kick payouts launches whales"
case "$1" in
  status) for j in $J; do printf '%-9s %s\n' $j "$(systemctl is-active t7@$j)"; done; journalctl -u 't7@*' -n 12 --no-pager -o cat;;
  logs) journalctl -u "t7@${2:-whales}" -n ${3:-40} --no-pager -o cat;;
  restart) for j in $J; do systemctl restart t7@$j; done; echo restarted;;
  stop) for j in $J; do systemctl stop t7@$j; done; echo stopped;;
  *) echo "t7 status | logs <kick|payouts|launches|whales> [lines] | restart | stop";;
esac
CMD
chmod 755 /usr/local/bin/t7
systemctl daemon-reload
for j in kick payouts launches whales; do systemctl enable t7@$j >/dev/null 2>&1; systemctl restart t7@$j; done
echo
echo "== running. Last step, once: add this server's key to the bot so it accepts the files:"
echo "   Cloudflare dashboard → Workers & Pages → war-room-bot → Settings → Variables and Secrets → + Add"
echo "   Type: Secret · Name: VPS_KEY · Value: the line below (stays on this server and in Cloudflare only)"
echo
grep '^VPS_KEY=' $ENV | cut -d= -f2-
echo
echo "Check on the jobs any time with:  t7 status    (code updates arrive by themselves within ~10 min of a push)"
