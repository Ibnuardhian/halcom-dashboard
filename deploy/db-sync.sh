#!/usr/bin/env bash
# Runs on the VPS (copied to /opt/halcom by the deploy workflow). Three modes:
#
#   neon-to-vps   Before the move: copy Neon over the VPS database, so the VPS follows Neon. Run it every night (cron).
#                 It OVERWRITES the VPS database, so it refuses to run once /opt/halcom/CUTOVER_DONE exists.
#   cutover       The night of the move: the same copy once more, then creates CUTOVER_DONE. After this the VPS is the source of truth
#                 and neon-to-vps can never run again. Stop everyone from using the old application on Neon before you run it.
#   vps-to-neon   After the move: nightly backup copy of the VPS database into a SEPARATE Neon database (NEON_BACKUP_URL).
#                 It refuses to run before CUTOVER_DONE exists, so it can never overwrite Neon while Neon is still the live database.
#
# Secrets are in /opt/halcom/neon.env (chmod 600, never committed):
#   NEON_URL=...          direct (not pooled) connection string of the live Neon database, ends with ?sslmode=require
#   NEON_BACKUP_URL=...   a different Neon database that only holds the backup copy (used after the move)
# Dumps are kept in /opt/halcom/sync (the 7 newest of each kind).
set -euo pipefail

cd "$(dirname "$0")"
export DOCKER_CONFIG="$PWD/.docker"
mkdir -p "$DOCKER_CONFIG" sync
mode="${1:-}"
case "$mode" in neon-to-vps | cutover | vps-to-neon) ;; *)
  echo "Usage: db-sync.sh neon-to-vps | cutover | vps-to-neon" >&2
  exit 2
  ;;
esac

project=halcom-dashboard
compose="docker compose -p ${project} -f compose.hostinger.yaml"
[ -f .env ] || { echo "Missing /opt/halcom/.env." >&2; exit 1; }
[ -f neon.env ] || { echo "Missing /opt/halcom/neon.env (NEON_URL, NEON_BACKUP_URL)." >&2; exit 1; }
set -a
# shellcheck disable=SC1091
. ./neon.env
set +a

umask 077
exec 9> sync/.lock
flock -n 9 || { echo "Another sync is running." >&2; exit 1; }

db="$($compose ps -q db)"
[ -n "$db" ] || { echo "The db container is not running." >&2; exit 1; }
stamp="$(date -u +%Y%m%d-%H%M%SZ)"

verify() { docker exec -i "$db" pg_restore --list < "$1" > /dev/null || { echo "$1 is not a readable dump." >&2; exit 1; }; }
prune() { ls -1t sync/"$1"-*.dump 2> /dev/null | tail -n +8 | xargs -r rm --; }
dump_vps() { docker exec "$db" sh -c 'pg_dump -U "$POSTGRES_USER" -Fc --no-owner --no-privileges "$POSTGRES_DB"' > "$1"; [ -s "$1" ] || { echo "Empty dump of the VPS database." >&2; rm -f "$1"; exit 1; }; }

if [ "$mode" = "vps-to-neon" ]; then
  [ -f CUTOVER_DONE ] || { echo "Refusing: the move is not done (no CUTOVER_DONE). Neon is still the live database." >&2; exit 1; }
  : "${NEON_BACKUP_URL:?Set NEON_BACKUP_URL in neon.env}"
  [ "${NEON_BACKUP_URL}" != "${NEON_URL:-}" ] || { echo "Refusing: NEON_BACKUP_URL is the same as NEON_URL." >&2; exit 1; }
  echo "== Dumping the VPS database"
  dump="sync/vps-${stamp}.dump"
  dump_vps "$dump"
  verify "$dump"
  echo "== Restoring into the Neon backup database"
  docker exec -i -e DST="$NEON_BACKUP_URL" "$db" sh -c 'pg_restore --clean --if-exists --no-owner --no-privileges -d "$DST"' < "$dump"
  prune vps
  echo "== Done: backup copy in Neon ($dump kept on the VPS)"
  exit 0
fi

# neon-to-vps and cutover
[ ! -f CUTOVER_DONE ] || { echo "Refusing: CUTOVER_DONE exists, the VPS is the live database now." >&2; exit 1; }
: "${NEON_URL:?Set NEON_URL in neon.env}"

echo "== Dumping Neon"
dump="sync/neon-${stamp}.dump"
docker exec -e SRC="$NEON_URL" "$db" sh -c 'pg_dump "$SRC" -Fc --no-owner --no-privileges' > "$dump"
[ -s "$dump" ] || { echo "Empty dump from Neon (check NEON_URL: direct, not pooled)." >&2; rm -f "$dump"; exit 1; }
verify "$dump"

echo "== Keeping a copy of the VPS database before it is overwritten"
dump_vps "sync/vps-before-${stamp}.dump"

echo "== Stopping the app, restoring, migrating"
$compose stop app
restart_app() { $compose up -d --no-deps app; }
trap restart_app EXIT
# pg_restore exits 1 for harmless warnings too (Neon extensions and roles), so the exit code alone is not trusted: the table checks below decide.
docker exec -i "$db" sh -c 'pg_restore --clean --if-exists --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$dump" || echo "pg_restore reported warnings (exit $?), checking the result."
rows="$(docker exec "$db" sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select count(*) from users"' 2> /dev/null || echo 0)"
if [ "${rows:-0}" -lt 1 ]; then
  trap - EXIT
  echo "The restored database has no users: the restore failed. The app stays STOPPED. Restore sync/vps-before-${stamp}.dump to go back." >&2
  exit 1
fi
echo "Restored: ${rows} users."
# Neon may be on an older schema than the app on the VPS: apply the migrations the VPS image has and Neon lacks.
$compose run --rm --no-deps migrate

prune neon
ls -1t sync/vps-before-*.dump 2> /dev/null | tail -n +4 | xargs -r rm --

if [ "$mode" = "cutover" ]; then
  date -u +%Y-%m-%dT%H:%M:%SZ > CUTOVER_DONE
  echo "== CUTOVER_DONE created: the VPS is the live database; neon-to-vps is blocked from now on."
fi
echo "== Done ($mode): $dump"
