#!/bin/sh
# Development container entrypoint (Dockerfile target `dev`). Before running the
# requested command it:
#   1. runs `npm ci` into the node_modules volume whenever package-lock.json
#      changed, so the container always matches the committed lockfile, and
#   2. regenerates the Prisma client so it matches prisma/schema.prisma.
# Production images do not use this script.
set -eu

lock_stamp=node_modules/.package-lock.sha256

sync_dependencies() {
  if [ ! -f package-lock.json ]; then
    echo "[dev-entrypoint] package-lock.json not found; skipping npm ci." >&2
    return 0
  fi
  current=$(sha256sum package-lock.json | cut -d ' ' -f 1)
  if [ "$(cat "$lock_stamp" 2>/dev/null || true)" != "$current" ]; then
    echo "[dev-entrypoint] package-lock.json changed; running npm ci..."
    npm ci
    echo "$current" > "$lock_stamp"
  fi
}

generate_prisma_client() {
  if [ -f prisma/schema.prisma ] && [ -x node_modules/.bin/prisma ]; then
    node_modules/.bin/prisma generate
  fi
}

# Containers sharing these volumes (app, app-test, one-off `run` commands) take
# turns here so two `npm ci` runs never write node_modules at the same time.
exec 9>/home/node/.npm/.dev-entrypoint.lock
flock 9
sync_dependencies
generate_prisma_client
flock -u 9
exec 9>&-

exec "$@"
