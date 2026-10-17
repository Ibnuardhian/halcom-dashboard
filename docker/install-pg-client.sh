#!/bin/sh
# Installs the PostgreSQL 18 client tools (pg_dump, pg_restore) from the official PGDG
# repository, for the superadmin database backup (README › Backups). The client must be at least
# as new as the server, which is PostgreSQL 18 (compose.yaml). The repository signing key is
# downloaded over HTTPS and its fingerprint is checked before it is trusted.
set -eu

PGDG_KEY_FINGERPRINT="B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8"
KEY_FILE=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc

apt-get update
apt-get install -y --no-install-recommends ca-certificates curl gnupg
install -d /usr/share/postgresql-common/pgdg
curl -fsSL -o "$KEY_FILE" https://www.postgresql.org/media/keys/ACCC4CF8.asc

if ! gpg --show-keys --with-colons "$KEY_FILE" | grep -q "^fpr:::::::::${PGDG_KEY_FINGERPRINT}:"; then
  echo "PGDG signing key fingerprint does not match ${PGDG_KEY_FINGERPRINT}; refusing to continue." >&2
  exit 1
fi

codename=$(. /etc/os-release && echo "$VERSION_CODENAME")
echo "deb [signed-by=${KEY_FILE}] https://apt.postgresql.org/pub/repos/apt ${codename}-pgdg main" \
  > /etc/apt/sources.list.d/pgdg.list
apt-get update
apt-get install -y --no-install-recommends postgresql-client-18
apt-get purge -y --auto-remove curl gnupg
rm -rf /var/lib/apt/lists/*
pg_dump --version
