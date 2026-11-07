#!/usr/bin/env bash
# Runs on the VPS from cron (see deploy/HOSTINGER-DOCKER-MANAGER.md): asks the application to scan the open BOQ, RFQ and PO requests for
# SLA deadlines that are near (Warning) or passed (Danger) and to write the notifications (D-083). The call is made inside the app
# container to its own port, so the endpoint is never reached through Caddy; the production image has no curl, so Node's fetch is used.
# The secret is CRON_SECRET of the app container (set in /opt/halcom/.env); without it the endpoint answers 404 and this script fails.
set -euo pipefail

cd "$(dirname "$0")"
compose="docker compose -p halcom-dashboard -f compose.hostinger.yaml"
export DOCKER_CONFIG="$PWD/.docker"
mkdir -p "$DOCKER_CONFIG"

echo "== $(date -u +%FT%TZ) SLA scan"
$compose exec -T app node -e '
fetch("http://127.0.0.1:3000/api/internal/sla-scan", { method: "POST", headers: { authorization: "Bearer " + (process.env.CRON_SECRET || "") } })
  .then(async (response) => {
    console.log(response.status, await response.text());
    process.exit(response.ok ? 0 : 1);
  })
  .catch((error) => {
    console.error(String(error));
    process.exit(1);
  });
'
