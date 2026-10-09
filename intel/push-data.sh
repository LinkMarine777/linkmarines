#!/bin/bash
# save a job's files to the data branch. The bot and the other jobs commit to this branch too: start from its latest each
# try, lay our files on top, push. Run from the data checkout. FILES = the files to save (default: the whale radar's).
set +e
git config user.name "war-room-radar"
git config user.email "radar@users.noreply.github.com"
FILES=${FILES:-"terminal/whales.json terminal/whales-state.json terminal/chart.json"}
# first hand the changed files to the bot (its /data serves them at once; GitHub's copy lags up to 5 min behind its CDN). Best
# effort: the bot proves who we are with GitHub's signed token (needs `id-token: write`); git below stays the record and the fallback.
if [ -n "$ACTIONS_ID_TOKEN_REQUEST_URL" ]; then
  tok=$(curl -s -m 10 -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=war-room-bot" \
    | python3 -c 'import json, sys; print(json.load(sys.stdin).get("value", ""))' 2>/dev/null)
  for f in $FILES; do
    case "$f" in terminal/whales.json|terminal/whales-state.json|terminal/launches.json|terminal/chart.json) ;; *) continue ;; esac
    [ -n "$tok" ] && [ -f "$f" ] || continue
    git diff --quiet HEAD -- "$f" 2>/dev/null && continue   # unchanged since the last save
    curl -s -m 20 -o /dev/null -w "bot <- $f %{http_code}\n" -X POST -H "Authorization: Bearer $tok" -H 'content-type: application/json' \
      --data-binary @"$f" "https://war-room-bot.linkmarine777.workers.dev/ingest?path=$f" || true
  done
fi
mkdir -p "$RUNNER_TEMP/save"
for f in $FILES; do [ -f "$f" ] && cp "$f" "$RUNNER_TEMP/save/"; done
for i in 1 2 3 4 5; do
  git fetch -q origin data && git reset -q --hard origin/data
  for f in $FILES; do [ -f "$RUNNER_TEMP/save/$(basename "$f")" ] && cp "$RUNNER_TEMP/save/$(basename "$f")" "$f" && git add "$f"; done
  git diff --cached --quiet && exit 0
  git commit -q -m "${1:-whale radar}" && git push -q origin HEAD:data && exit 0
  sleep $((i * 5))
done
exit 1
