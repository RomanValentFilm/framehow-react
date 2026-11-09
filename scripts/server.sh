#!/bin/sh
# THE SERVER DEPLOY, ONE LINE, SAME ENDING AS THE APP'S (Roman, 9 Nov).
#
#   npm run server -- <run> "<what changed>"                       deploy the worker
#   FH_MIGRATION=0034_x.sql npm run server -- <run> "<what changed>"   run that migration first
#
# Ends like scripts/deploy.sh: a sound and a line naming the run, so Roman knows
# which one just finished and says zzz.
RUN="$1"; MSG="$2"
cd backend || exit 1
SND=none
finish() {
  afplay /System/Library/Sounds/Glass.aiff 2>/dev/null & SND="sound played"
  osascript -e "display notification \"$1 — say zzz\" with title \"Framehow server\"" 2>/dev/null
  echo "--- $1 (server, run $RUN: $MSG) — say zzz — $SND ---"
}
echo "=== SERVER DEPLOY — run $RUN: $MSG ==="
if [ -n "$FH_MIGRATION" ]; then
  npx --yes wrangler d1 execute framehow-db --remote --file="migrations/$FH_MIGRATION" || { finish "Migration FAILED, server not deployed"; exit 1; }
fi
npx --yes wrangler deploy || { finish "Server deploy FAILED"; exit 1; }
finish "Server is up"
