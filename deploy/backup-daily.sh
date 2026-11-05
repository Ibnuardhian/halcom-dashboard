#!/usr/bin/env bash
# Runs on the VPS from cron (see deploy/HOSTINGER-DOCKER-MANAGER.md): one full database dump a day into the application's /backups
# volume, so it shows on the Backups page of the application (and can be downloaded there). Files are named
# halcom-auto-YYYYMMDD-HHMMSSZ.dump, mode 600. The newest dumps are kept: those older than KEEP_DAYS (30) are removed, but never
# the newest MIN_KEEP (3), so a long outage of this job cannot empty the folder. Files made from the Backups page are never touched.
# The dump is checked with pg_restore --list before it gets its final name, so a half-written file never looks like a backup.
set -euo pipefail

cd "$(dirname "$0")"
keep_days="${KEEP_DAYS:-30}"
min_keep="${MIN_KEEP:-3}"
compose="docker compose -p halcom-dashboard -f compose.hostinger.yaml"
export DOCKER_CONFIG="$PWD/.docker"
mkdir -p "$DOCKER_CONFIG"

name="halcom-auto-$(date -u +%Y%m%d-%H%M%SZ).dump"
echo "== $(date -u +%FT%TZ) Backing up to /backups/$name"

# pg_dump runs in the db container (same version as the server) and is piped into the app container, which owns the backups volume.
# Neither the password nor the dump touches the host disk. pipefail makes a failure on either side stop the script.
$compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' \
  | $compose exec -T app sh -c 'umask 077 && cat > "/backups/$0.partial"' "$name"

if ! $compose exec -T app sh -c 'pg_restore --list "/backups/$0.partial" > /dev/null && mv "/backups/$0.partial" "/backups/$0"' "$name"; then
  $compose exec -T app rm -f "/backups/${name}.partial" || true
  echo "The dump failed the check; nothing was kept." >&2
  exit 1
fi
size="$($compose exec -T app sh -c 'wc -c < "/backups/$0"' "$name" | tr -d '[:space:]')"
echo "Done: $name ($size bytes)"

# Retention: only the daily job's files, only those older than KEEP_DAYS, and never the newest MIN_KEEP.
$compose exec -T app sh -c '
  ls -1t /backups/halcom-auto-*.dump 2>/dev/null | tail -n +"$(( $1 + 1 ))" | while read -r f; do
    if [ -n "$(find "$f" -mtime +"$0")" ]; then rm -- "$f" && echo "Removed old backup: $f"; fi
  done
' "$keep_days" "$min_keep"
