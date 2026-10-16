#!/usr/bin/env bash
# Terminal 7's data jobs on their own VPS (Ubuntu/Debian, any size: they mostly wait on the network). Outbound only: no ports
# are opened. Run as root, from a file (it asks you to add two keys on GitHub and waits for you):
#   curl -fsSL https://raw.githubusercontent.com/LinkMarine777/linkmarines/main/vps/setup.sh -o t7setup.sh && sudo bash t7setup.sh
# Re-running is safe: it keeps the keys in /etc/t7.env and in /opt/t7/.ssh and restarts the jobs on the latest code.
#   jobs (one service each, restarted if they stop):  kick (the bot's stonkfun work, every 45 s) · payouts (stonkfun's payout
#   feed for the wallet X-Ray) · launches (launch radar, a pass every ~2 min) · whales (whale radar: a full pass every 30 min,
#   fast passes in between) · preload (the wallet X-Ray's preload) · compound (compounding every 6 h). Each hands its files to the
#   bot (POST /ingest with this server's key); compound writes to the data branch.
# The code is the private T7 repo (since 10-16), read with a read-only deploy key made here; compound saves to the linkmarines data
# branch with a second deploy key (write). The private parts of both keys never leave this server. No Helius key here: compound
# reads the chain through the bot (/rpc-vps, with this server's VPS_KEY).
# Root is used only by this script, which you run. The jobs run as the locked-down user t7 (no sudo, can't gain privileges, can
# write only to /opt/t7) and keep their own code up to date: each pulls the repo between passes and restarts itself when it
# changed. Nothing from the repo ever runs as root after this.
# Check on it:  t7 status · t7 logs whales · t7 restart
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run as root (sudo)"; exit 1; }
APP=/opt/t7; ENV=/etc/t7.env
CODE=git@gh-t7:LinkMarine777/T7.git                       # private: the jobs' code (read-only key)
DATA=https://github.com/LinkMarine777/linkmarines         # public: the data branch (reads)
DATA_PUSH=git@gh-data:LinkMarine777/linkmarines.git        # compound's saves (write key)
JOBS="kick payouts launches whales preload compound"
T() { runuser -u t7 -- "$@"; }
ask() { local a; read -r -p "$1" a </dev/tty || a=s; echo "$a"; }   # (no terminal to answer from: skip)
echo "== packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq && apt-get install -y -qq git python3 curl ca-certificates openssh-client >/dev/null
id t7 >/dev/null 2>&1 || useradd -r -m -d $APP -s /usr/sbin/nologin t7

echo "== GitHub keys"
S=$APP/.ssh; install -d -o t7 -g t7 -m 700 $S
[ -f $S/t7_code ] || T ssh-keygen -q -t ed25519 -N '' -C t7-vps-code -f $S/t7_code
[ -f $S/t7_data ] || T ssh-keygen -q -t ed25519 -N '' -C t7-vps-data -f $S/t7_data
cat > $S/config <<'CFG'
Host gh-t7
  HostName github.com
  User git
  IdentityFile /opt/t7/.ssh/t7_code
  IdentitiesOnly yes
Host gh-data
  HostName github.com
  User git
  IdentityFile /opt/t7/.ssh/t7_data
  IdentitiesOnly yes
CFG
echo 'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl' > $S/known_hosts   # GitHub's published host key
chown t7:t7 $S/config $S/known_hosts; chmod 600 $S/config
export GIT_SSH_COMMAND="ssh -F $S/config -o UserKnownHostsFile=$S/known_hosts"
code_ok() { T env GIT_SSH_COMMAND="$GIT_SSH_COMMAND" git ls-remote -q $CODE HEAD >/dev/null 2>&1; }
while ! code_ok; do
  echo
  echo "KEY 1 of 2 — lets this server read the private T7 repo (read-only)."
  echo "  Open: https://github.com/LinkMarine777/T7/settings/keys/new"
  echo "  Title: t7 vps · Key: the line below · leave 'Allow write access' OFF · Add key"
  echo
  cat $S/t7_code.pub
  echo
  a=$(ask "Press Enter once it's added (or type s to skip and keep the jobs on the old public code): ")
  [ "$a" = s ] && break
done

echo "== code"
if code_ok; then
  if [ "$(T git -C $APP/site remote get-url origin 2>/dev/null)" != "$CODE" ]; then
    rm -rf $APP/site.new; T env GIT_SSH_COMMAND="$GIT_SSH_COMMAND" git clone -q --depth 1 $CODE $APP/site.new
    T git -C $APP/site.new config core.sshCommand "$GIT_SSH_COMMAND"
    rm -rf $APP/site.old; [ -d $APP/site ] && mv $APP/site $APP/site.old; mv $APP/site.new $APP/site
    echo "   jobs' code: now the private T7 repo (the old copy is in $APP/site.old)"
  else T git -C $APP/site fetch -q --depth 1 origin main && T git -C $APP/site reset -q --hard FETCH_HEAD; echo "   jobs' code: T7, up to date"; fi
else
  echo "   skipped: the jobs keep the code they have"
  [ -d $APP/site/.git ] || T git clone -q --depth 1 https://github.com/LinkMarine777/linkmarines $APP/site
fi
for j in launches whales compound; do   # each job its own copy of the data branch (they refresh it before every pass)
  [ -d $APP/data-$j/.git ] || T git clone -q --depth 1 --single-branch --branch data $DATA $APP/data-$j
done
T git -C $APP/data-compound remote set-url --push origin $DATA_PUSH
T git -C $APP/data-compound config core.sshCommand "$GIT_SSH_COMMAND"
compound=1
until T git -C $APP/data-compound push --dry-run -q origin HEAD:data >/dev/null 2>&1; do
  echo
  echo "KEY 2 of 2 — lets the compounding job save its files to the linkmarines data branch."
  echo "  Open: https://github.com/LinkMarine777/linkmarines/settings/keys/new"
  echo "  Title: t7 vps compound · Key: the line below · tick 'Allow write access' · Add key"
  echo
  cat $S/t7_data.pub
  echo
  a=$(ask "Press Enter once it's added (or type s to skip: compounding stays on GitHub for now): ")
  [ "$a" = s ] && { compound=0; break; }
done

if [ ! -f $ENV ]; then
  KEY=$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 48)
  printf 'VPS_KEY=%s\nHELIUS_KEY=\n' "$KEY" > $ENV
  NEWKEY=1
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
systemctl disable --now t7-update.timer >/dev/null 2>&1 || true; rm -f /etc/systemd/system/t7-update.service /etc/systemd/system/t7-update.timer
cat > /usr/local/bin/t7 <<'CMD'
#!/bin/bash
J="kick payouts launches whales preload compound"
case "$1" in
  status) for j in $J; do printf '%-9s %s\n' $j "$(systemctl is-active t7@$j)"; done; printf 'code      %s\n' "$(git -C /opt/t7/site remote get-url origin 2>/dev/null)"; journalctl -u 't7@*' -n 12 --no-pager -o cat;;
  logs) journalctl -u "t7@${2:-whales}" -n ${3:-40} --no-pager -o cat;;
  restart) for j in $J; do systemctl is-enabled -q t7@$j 2>/dev/null && systemctl restart t7@$j; done; echo restarted;;
  stop) for j in $J; do systemctl stop t7@$j; done; echo stopped;;
  *) echo "t7 status | logs <kick|payouts|launches|whales|preload|compound> [lines] | restart | stop";;
esac
CMD
chmod 755 /usr/local/bin/t7
systemctl daemon-reload
for j in kick payouts launches whales preload; do systemctl enable t7@$j >/dev/null 2>&1; systemctl restart t7@$j; done
if [ $compound = 1 ] && [ -f $APP/site/intel/compound.py ] && grep -q rpc-vps $APP/site/intel/compound.py; then
  systemctl enable t7@compound >/dev/null 2>&1; systemctl restart t7@compound; echo "   compound: on (this server, every 6 h)"
else systemctl disable --now t7@compound >/dev/null 2>&1 || true; echo "   compound: off here (GitHub keeps running it)"; fi
echo
if [ -n "${NEWKEY:-}" ]; then
  echo "== new server: add its key to the bot so it accepts the files:"
  echo "   Cloudflare dashboard → Workers & Pages → war-room-bot → Settings → Variables and Secrets → + Add"
  echo "   Type: Secret · Name: VPS_KEY · Value: the line below (stays on this server and in Cloudflare only)"
  echo; grep '^VPS_KEY=' $ENV | cut -d= -f2-; echo
fi
t7 status | head -8
echo
echo "Done. Check on the jobs any time with:  t7 status"
