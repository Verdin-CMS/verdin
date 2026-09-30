#!/bin/sh
# Runs the hosted playground: a fresh SQLite database of the blog example, seeded with
# demo content, wiped and started again every PLAYGROUND_RESET_SECONDS (default: one
# hour). Each cycle gets new secrets, so sessions and tokens from the last one end too.
set -eu

DATA="${PLAYGROUND_DATA:-/var/lib/verdin-playground}"
INTERVAL="${PLAYGROUND_RESET_SECONDS:-3600}"
PORT="${VERDIN_SERVER__PORT:-1337}"
export VERDIN_DATABASE_URL="sqlite://$DATA/verdin.db"

say() { printf 'playground: %s\n' "$*" >&2; }

server=""
stop_server() {
    if [ -n "$server" ] && kill -0 "$server" 2>/dev/null; then
        kill -TERM "$server" 2>/dev/null || true
        wait "$server" 2>/dev/null || true
    fi
    server=""
}
trap 'stop_server; exit 0' TERM INT

while :; do
    say "resetting $DATA"
    stop_server
    # Empty the directory rather than removing it: it may be a tmpfs mount point.
    mkdir -p "$DATA"
    find "$DATA" -mindepth 1 -delete
    eval "$(verdin secrets | sed 's/^/export /')"

    verdin start --migrate &
    server=$!

    ready=""
    i=0
    while [ "$i" -lt 120 ]; do
        kill -0 "$server" 2>/dev/null || { say "the server exited during startup"; exit 1; }
        if curl -fsS "http://127.0.0.1:$PORT/_ready" >/dev/null 2>&1; then ready=1; break; fi
        i=$((i + 1))
        sleep 1
    done
    [ -n "$ready" ] || { say "the server did not become ready"; stop_server; exit 1; }

    "$(dirname "$0")/seed.sh" || { say "seeding failed"; stop_server; exit 1; }
    say "ready; next reset in ${INTERVAL}s"

    # Wait in short steps so TERM is handled at once, and start over early if the server
    # stops by itself.
    waited=0
    while [ "$waited" -lt "$INTERVAL" ]; do
        kill -0 "$server" 2>/dev/null || { say "the server stopped; starting over"; break; }
        sleep 5 &
        wait $! || true
        waited=$((waited + 5))
    done
done
