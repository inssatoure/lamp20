#!/bin/bash
# LAMP AI — automatic update for shared hosting (cPanel cron, every 10 minutes).
# Gets the new code from GitHub; if it changed: installs packages if needed, checks the code,
# and restarts the app. If the new code does not even load, it goes back to the previous version.
#   */10 * * * * source $HOME/nodevenv/lamp20/deploy-bot/22/bin/activate && bash $HOME/lamp20/deploy-bot/scripts/update.sh >> $HOME/lamp-update.log 2>&1
cd "$(dirname "$0")/../.." || exit 1
git fetch -q origin main || { echo "$(date '+%F %T') fetch failed"; exit 0; }
OLD=$(git rev-parse HEAD); NEW=$(git rev-parse origin/main)
[ "$OLD" = "$NEW" ] && exit 0
[ "$(cat .lamp-bad-commit 2>/dev/null)" = "$NEW" ] && exit 0      # already refused: wait for a fixed version
CHANGED=$(git diff --name-only "$OLD" "$NEW")
git reset -q --hard "$NEW"
cd deploy-bot || exit 1
if echo "$CHANGED" | grep -q '^deploy-bot/package'; then npm install --omit=dev --no-audit --no-fund --loglevel=error; fi
for f in start.cjs app.js lib/*.js; do
  if ! node --check "$f" 2>/dev/null; then
    echo "$(date '+%F %T') $f does not load — back to $OLD"
    cd .. && git reset -q --hard "$OLD" && echo "$NEW" > .lamp-bad-commit && exit 1
  fi
done
mkdir -p tmp && touch tmp/restart.txt          # Passenger (cPanel Node.js) restarts the app on the next request
echo "$(date '+%F %T') updated ${OLD:0:7} → ${NEW:0:7}"
