#!/usr/bin/env bash

set -euo pipefail

log() {
  printf '[restartwm] %s\n' "$*"
}

# Identify running Wingman web server processes (spawned by npm run web)
PIDS=$(pgrep -f "bin/wingman-web" || true)

if [ -n "$PIDS" ]; then
  log "Stopping Wingman web server (PIDs: $PIDS)"
  kill $PIDS 2>/dev/null || true

  # Wait up to 5 seconds for graceful shutdown
  for _ in {1..10}; do
    sleep 0.5
    alive=0
    for pid in $PIDS; do
      if ps -p "$pid" > /dev/null 2>&1; then
        alive=1
        break
      fi
    done
    if ((alive == 0)); then
      break
    fi
  done

  # Force kill any stubborn processes
  for pid in $PIDS; do
    if ps -p "$pid" > /dev/null 2>&1; then
      log "Force killing PID $pid"
      kill -9 "$pid" 2>/dev/null || true
    fi
  done
else
  log "No existing Wingman web server process found"
fi

log "Starting Wingman web server..."
npm run web
