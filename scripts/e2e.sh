#!/bin/sh
# ONE COMMAND FOR THE SIMULATOR (#309).
#
#   npm run t                         every scenario
#   npm run t -- -g "stop listening"  just the ones whose name matches
#
# Always does the same three things, so there is nothing to remember:
#   1. runs the tests, printing progress as they go
#   2. writes the WHOLE run to e2e-log/last-run.log, which Claude reads
#      directly — nothing to copy, nothing to paste, nothing cut off
#   3. pings, so you can look away while it runs
#
# When it beeps, say "zzz". That is the whole workflow.
#
# The log lives in its OWN folder, NOT in e2e-report: playwright's html reporter
# empties e2e-report before it writes, so the first version of this script
# carefully saved the log and then watched playwright delete it.
#
# EVERY RUN HAS A NUMBER (#367). Claude puts FH_RUN=<n> at the front of the
# command it gives you; the number is written as the first line of the log, so
# when you say "zzz" Claude can say WHICH run it is reading and neither of you
# has to guess whether a command was already posted.
mkdir -p e2e-log
# KEEP THE MAC AWAKE WHILE IT RUNS (#383). A full run is nine minutes of two
# browsers talking to each other with nobody touching the keyboard, which is
# exactly when a Mac decides to sleep — and a sleeping machine looks in the log
# like devices that stopped agreeing. `caffeinate -i` holds off idle sleep for
# as long as the tests run and nothing longer.
{ echo "=== RUN ${FH_RUN:-unnumbered} — $(date '+%H:%M:%S') — args: $* ==="; \
  caffeinate -i npx playwright test --project=webkit "$@" 2>&1; } | tee e2e-log/last-run.log | grep -v WebServer
afplay /System/Library/Sounds/Glass.aiff 2>/dev/null &
osascript -e 'display notification "Tests finished — say zzz" with title "Framehow"' 2>/dev/null
echo
# The number is on the last line too, not only the first (#383). The log's first
# line scrolls away long before a run ends, and Roman pastes the tail — so this
# is where he can see which run he just finished without hunting for it.
echo "--- FH_RUN=${FH_RUN:-unnumbered} finished. say  zzz  ---"
