#!/bin/bash
# save the radar's files to the data branch. The bot commits to this branch too: start from its latest each try, lay our
# files on top, push. Run from the data checkout.
set +e
git config user.name "war-room-radar"
git config user.email "radar@users.noreply.github.com"
cp terminal/whales.json terminal/whales-state.json "$RUNNER_TEMP/"; cp terminal/chart.json "$RUNNER_TEMP/" 2>/dev/null
for i in 1 2 3 4 5; do
  git fetch -q origin data && git reset -q --hard origin/data
  cp "$RUNNER_TEMP/whales.json" "$RUNNER_TEMP/whales-state.json" terminal/; [ -f "$RUNNER_TEMP/chart.json" ] && cp "$RUNNER_TEMP/chart.json" terminal/
  git add terminal/whales.json terminal/whales-state.json terminal/chart.json
  git diff --cached --quiet && exit 0
  git commit -q -m "${1:-whale radar}" && git push -q origin HEAD:data && exit 0
  sleep $((i * 5))
done
exit 1
