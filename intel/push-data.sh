#!/bin/bash
# save a job's files to the data branch. The bot and the other jobs commit to this branch too: start from its latest each
# try, lay our files on top, push. Run from the data checkout. FILES = the files to save (default: the whale radar's).
set +e
git config user.name "war-room-radar"
git config user.email "radar@users.noreply.github.com"
FILES=${FILES:-"terminal/whales.json terminal/whales-state.json terminal/chart.json"}
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
