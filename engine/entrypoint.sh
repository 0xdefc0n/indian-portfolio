#!/bin/sh
# Runs the engine and restarts it after every ENGINE_MAX_REQUESTS requests (uvicorn exits 0 at the limit).
# Recycling caps slow memory growth from the PDF libraries' caches (plan §14). Stops cleanly on SIGTERM.
set -u
child=0
stop() {
  [ "$child" -ne 0 ] && kill -TERM "$child" 2>/dev/null && wait "$child"
  exit 0
}
trap stop TERM INT
while :; do
  uvicorn engine.server:app --host 0.0.0.0 --port "${PORT:-8080}" --workers 1 --no-access-log \
    --log-level warning --limit-max-requests "${ENGINE_MAX_REQUESTS:-200}" &
  child=$!
  wait "$child"
  code=$?
  child=0
  [ "$code" -ne 0 ] && sleep 1  # crashed: brief back-off before restarting
done
