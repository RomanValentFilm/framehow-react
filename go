#!/bin/sh
# THE TERMINAL WAITS FOR YOU, NOT THE OTHER WAY ROUND (#321).
#
# Start it once:   ./go
# After that the only thing you ever type is  y  or  n.
#
# It sits there watching. When Claude queues something it prints, in plain
# words, what it is about to do and whether it touches your devices, and waits.
# You answer. It runs, writes everything where Claude can read it, beeps, and
# goes back to waiting.
#
# Ctrl-C to stop it.
#
# Why: the commands had grown to twenty lines with a paragraph of commit message
# inside them, and pasting one into a terminal broke the shell halfway through a
# quote. Nothing that long should go through a clipboard. Now nothing does.
#
# The y/n is deliberate and stays. Roman decides; the machine types.

cd "$(dirname "$0")"

PLAN=.next/plan
RUN=.next/run
LOG=e2e-log/last.log

mkdir -p .next e2e-log

echo
echo "  Framehow — waiting for something to do."
echo "  Leave this window open. Ctrl-C to stop."
echo

while true; do
  # Wait for Claude to queue something.
  while [ ! -f "$RUN" ]; do
    sleep 1
  done
  # A moment's grace: the plan and the run are written as two separate files and
  # this could otherwise catch the run before its description exists.
  sleep 1

  # YOUR TURN (#328). A different sound from the finished one, so you can
  # tell "it needs you" from "it is done" without looking at the screen.
  afplay /System/Library/Sounds/Submarine.aiff 2>/dev/null &
  # A RUNNING NUMBER (#351). "Say y" is not something to answer blind; a job
  # you can name is. Roman: "can we give these y's some number, so i know what
  # i'm doing?"
  N=$(cat .next/counter 2>/dev/null || echo 0)
  N=$((N + 1))
  echo "$N" > .next/counter
  echo "────────────────────────  JOB $N  ────────────────────────"
  cat "$PLAN" 2>/dev/null || echo "  (no description — ask Claude what this is)"
  echo "────────────────────────────────────────────────────────────"
  echo
  printf "  JOB %s — y to run, n to skip: " "$N"
  read -r answer </dev/tty

  # Used up either way. A plan that has been answered must never be answered
  # twice — an accidental second yes must not deploy twice.
  mv "$RUN" .next/last-run 2>/dev/null

  case "$answer" in
    y|Y|yes|YES)
      echo
      echo "  working — the first output can take twenty seconds"
      echo
      sh .next/last-run 2>&1 | tee "$LOG"
      afplay /System/Library/Sounds/Glass.aiff 2>/dev/null &
      echo
      echo "  ────────────  JOB $N finished. say  zzz  ────────────"
      echo
      ;;
    *)
      echo
      echo "  Skipped. Nothing was run."
      echo
      ;;
  esac
done
