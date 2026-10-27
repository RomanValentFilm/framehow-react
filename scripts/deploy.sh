#!/bin/sh
# ONE SHORT COMMAND FOR A DEPLOY (Roman, 24 Oct: "make it shorter").
#
#   npm run deploy -- <run> "<what changed>"               tests matching FH_T, then dev
#   FH_T="max screen|phone cam" npm run deploy -- 413 "…"  only those tests first
#   FH_LIVE=1 npm run deploy -- 414 "…"                    the full run, then dev AND live
#
# Always the same steps, in this order, and it stops at the first that fails:
#   1. the tests (all of them when FH_T is empty)
#   2. commit with the message, signed as usual
#   3. a copy into framehow-react-versions/<version> (version read from the app)
#   4. build and upload to dev
#   5. with FH_LIVE=1: push to GitHub main, which is framehow.com/app
# One beep and one "say zzz" at the very end, whatever happened.
set -e
cd "$(dirname "$0")/.."
RUN="$1"; MSG="$2"
if [ -z "$RUN" ] || [ -z "$MSG" ]; then echo "usage: npm run deploy -- <run number> \"<what changed>\""; exit 2; fi
VERSION=$(grep -o "APP_VERSION = '[^']*'" src/store/state.ts | sed "s/.*'\(.*\)'/\1/")
TAG=$(grep -o "SYNC_BUILD_TAG = '[^']*'" src/lib/syncTrace.ts | sed "s/.*'\(.*\)'/\1/")
echo "=== DEPLOY $VERSION · $TAG — run $RUN${FH_LIVE:+ — AND LIVE} ==="
finish() {
  # THE SOUND SAYS WHETHER IT PLAYED (27 Oct, Roman: "there is no sound when
  # finished now"). Its error used to be thrown away; now the last line tells,
  # and if Glass fails the Mac's own alert beep sounds instead.
  if SND_ERR=$(afplay /System/Library/Sounds/Glass.aiff 2>&1); then SND="sound played"
  else SND="sound failed: ${SND_ERR:-no reason given} — beeped instead"; osascript -e 'beep 2' 2>/dev/null; fi
  osascript -e "display notification \"$1 — say zzz\" with title \"Framehow\"" 2>/dev/null
  echo "--- $1 ($VERSION · $TAG, run $RUN) — say zzz — $SND ---"
}
if [ -n "$FH_T" ]; then
  FH_QUIET=1 FH_RUN="$RUN" sh scripts/e2e.sh -g "$FH_T" || { finish "Tests RED, nothing deployed"; exit 1; }
else
  FH_QUIET=1 FH_RUN="$RUN" sh scripts/e2e.sh || { finish "Tests RED, nothing deployed"; exit 1; }
fi
{
  git add -A &&
  # Nothing new since the last deploy (run 464: the full run on code already
  # committed) is not a failure — the tests just proved that commit.
  { git diff --cached --quiet && echo "nothing new to commit — $VERSION is already committed"; } ||
  git commit -q -m "$MSG ($VERSION $TAG)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" &&
  mkdir -p "$HOME/Desktop/Framehow Files/framehow-react-versions/$VERSION" &&
  rsync -a --exclude node_modules --exclude .git --exclude e2e-report --exclude e2e-log --exclude test-results \
    --exclude dist --exclude e2e/fixtures --exclude .wrangler --exclude .wrangler-e2e --exclude site --exclude .bench \
    ./ "$HOME/Desktop/Framehow Files/framehow-react-versions/$VERSION/" &&
  npm run build &&
  npx --yes wrangler pages deploy dist --project-name=framehow-react --branch=dev --commit-dirty=true
} || { finish "Deploy FAILED after green tests"; exit 1; }
if [ -n "$FH_LIVE" ]; then
  git push origin v4.4:main || { finish "Dev is up, LIVE push failed"; exit 1; }
  finish "Dev AND LIVE are up"
else
  finish "Dev is up"
fi
