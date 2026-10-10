#!/usr/bin/env bash
# One Terminal 7 job, forever (systemd restarts it if it stops): kick | payouts | launches | whales. See vps/setup.sh.
J=${1:?job}; APP=${T7_APP:-/opt/t7}; S=$APP/site; BOT=https://war-room-bot.linkmarine777.workers.dev
log() { echo "$(date -u +%H:%M:%S) $*"; }
# the Helius key as typed at setup: the bare key, or the whole RPC address (https://mainnet.helius-rpc.com/?api-key=...), both work
HELIUS_KEY=$(printf '%s' "${HELIUS_KEY:-}" | tr -d ' "\r'"'"'')
case "$HELIUS_KEY" in http*) export SOLANA_RPC=$HELIUS_KEY; HELIUS_KEY= ;; *api-key=*) HELIUS_KEY=${HELIUS_KEY##*api-key=}; HELIUS_KEY=${HELIUS_KEY%%&*} ;; esac
# until the Helius plan renews (Wed 2026-10-14 12:00 UTC; credits ran low 10-10) the whale radar uses the free public RPC
[ "$(date -u +%s)" -lt "$(date -u -d 2026-10-14T12:00:00Z +%s)" ] && { HELIUS_KEY=; unset SOLANA_RPC; }
export HELIUS_KEY
# new code on GitHub (checked at most every 10 min, as this locked-down user): take it and exit; systemd starts the job again on it
code() { [ $(( $(date +%s) - ${CHK:-0} )) -lt 600 ] && return; CHK=$(date +%s); local old; old=$(git -C $S rev-parse HEAD)
  git -C $S fetch -q --depth 1 origin main 2>/dev/null && git -C $S reset -q --hard FETCH_HEAD
  [ "$(git -C $S rev-parse HEAD)" != "$old" ] && { log "new code $(git -C $S rev-parse --short HEAD): restarting"; exit 0; }; }
# the data branch's latest (the bot's board / tokens, compounding...) under this job's own files, which are kept
refresh() { local D=$1; shift; local keep; keep=$(mktemp -d)
  for f in "$@"; do [ -f "$D/$f" ] && cp "$D/$f" "$keep/"; done
  git -C "$D" fetch -q --depth 1 origin data 2>/dev/null && git -C "$D" reset -q --hard FETCH_HEAD
  for f in "$@"; do [ -f "$keep/$(basename "$f")" ] && cp "$keep/$(basename "$f")" "$D/$f"; done; rm -rf "$keep"; }
# hand the changed files to the bot (its /data serves them at once; it skips the GitHub job's copies while these are fresh)
ingest() { local D=$1; shift; local f code
  [ -n "$VPS_KEY" ] || { log "no VPS_KEY in /etc/t7.env"; return; }
  for f in "$@"; do [ -s "$D/$f" ] || continue; cmp -s "$D/$f" "$D/.sent-$(basename "$f")" && continue
    code=$(curl -s -m 30 -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $VPS_KEY" -H 'content-type: application/json' --data-binary @"$D/$f" "$BOT/ingest?path=$f")
    log "bot <- $f $code"; [ "$code" = 200 ] && cp "$D/$f" "$D/.sent-$(basename "$f")"; done; }
case "$J" in
  kick)      # the bot's stonkfun work (holder-payout alerts, the payouts snapshot) as a web request: stonkfun refuses its scheduled ones
    while true; do code; log "$(curl -s -m 50 $BOT/kick | tr '\n' ' ')"; sleep 45; done ;;
  payouts)   # stonkfun's payout feed for the wallet X-Ray (the bot reads ~20 s a call until every coin is caught up)
    while true; do code; MINUTES=50 python3 $S/intel/payout_feed.py; sleep 120; done ;;
  launches)  # launch radar: a pass every ~2 min
    D=$APP/data-launches; OWN="terminal/launches.json terminal/launches-state.json"
    while true; do code; t0=$(date +%s)
      refresh $D $OWN; python3 $S/intel/launches.py $D/terminal || log "pass failed"; ingest $D terminal/launches.json
      left=$(( 120 - ($(date +%s) - t0) )); [ $left -gt 0 ] && sleep $left; done ;;
  whales)    # whale radar: a full pass every 30 min (RPC), fast passes in between; the launch radar's newest file folded in
    D=$APP/data-whales; OWN="terminal/whales.json terminal/whales-state.json terminal/chart.json"; full=0
    while true; do code
      refresh $D $OWN; cp $APP/data-launches/terminal/launches.json $D/terminal/launches.json 2>/dev/null
      if [ $(( $(date +%s) - full )) -ge 1800 ]; then full=$(date +%s); log "full pass"; python3 $S/intel/whales.py $D/terminal || log "full pass failed"
      else FAST=1 python3 $S/intel/whales.py $D/terminal >/dev/null || log "fast pass failed"; fi
      ingest $D $OWN; sleep 5; done ;;
  *) echo "unknown job $J"; exit 1 ;;
esac
