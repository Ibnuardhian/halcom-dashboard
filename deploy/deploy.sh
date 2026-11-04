#!/usr/bin/env bash
# Runs on the VPS (copied to /opt/halcom by the deploy workflow). It backs up the database, pulls the images, runs the migrations,
# starts the new app and checks its health. If the app is not healthy it puts the previous image back.
# Needed in the environment: APP_IMAGE, MIGRATE_IMAGE, IMAGE_TAG. The secrets are in /opt/halcom/.env, which Compose reads itself.
set -euo pipefail

cd "$(dirname "$0")"
: "${APP_IMAGE:?APP_IMAGE is not set}" "${MIGRATE_IMAGE:?MIGRATE_IMAGE is not set}" "${IMAGE_TAG:?IMAGE_TAG is not set}"
export APP_IMAGE MIGRATE_IMAGE IMAGE_TAG

[ -f .env ] || { echo "Missing /opt/halcom/.env (copy deploy/production.env.example and fill it in)." >&2; exit 1; }
compose="docker compose -f compose.prod.yaml"
port="$(grep -E '^APP_PORT=' .env | cut -d= -f2- || true)"
port="${port:-3000}"

previous=""
[ -f .last_good_tag ] && previous="$(cat .last_good_tag)"

echo "== Pulling $IMAGE_TAG"
$compose pull app
$compose --profile migrate pull migrate

echo "== Starting the database"
$compose up -d db
for _ in $(seq 1 30); do
  $compose exec -T db sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1 && break
  sleep 2
done
$compose exec -T db sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null

echo "== Backing up before the migration"
umask 077
mkdir -p predeploy
dump="predeploy/pre-${IMAGE_TAG}-$(date -u +%Y%m%d-%H%M%SZ).dump"
$compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > "$dump"
[ -s "$dump" ] || { echo "The backup is empty, stopping." >&2; rm -f "$dump"; exit 1; }
# Keep the ten newest pre-deploy dumps.
ls -1t predeploy/*.dump 2>/dev/null | tail -n +11 | xargs -r rm --

echo "== Migrating"
$compose --profile migrate run --rm migrate

echo "== Starting the app"
$compose up -d app

echo "== Waiting for /api/health"
healthy=0
for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:${port}/api/health" >/dev/null 2>&1; then healthy=1; break; fi
  sleep 3
done

if [ "$healthy" -ne 1 ]; then
  echo "The app is not healthy. Last log lines:" >&2
  $compose logs --tail 80 app >&2 || true
  if [ -n "$previous" ] && [ "$previous" != "$IMAGE_TAG" ]; then
    echo "Putting the previous image ($previous) back. The database migrations are NOT undone: restore $dump if a migration is to blame." >&2
    IMAGE_TAG="$previous" $compose up -d app
  fi
  exit 1
fi

echo "$IMAGE_TAG" > .last_good_tag
docker image prune -f >/dev/null
echo "== Done: $IMAGE_TAG is live. Backup before this deploy: $dump"
