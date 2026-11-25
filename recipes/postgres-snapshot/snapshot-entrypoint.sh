#!/usr/bin/env bash
set -Eeuo pipefail
# Preserve postgres --help/version behavior, as the official entrypoint does.
if [[ "${1:-}" != postgres ]]; then exec docker-entrypoint.sh "$@"; fi
export PGDATA="${PGDATA:-/var/lib/postgresql/data}"
if [[ ! -s "$PGDATA/PG_VERSION" ]]; then
  : "${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD for the snapshot test container}"
  mkdir -p "$PGDATA"
  if [[ $(id -u) == 0 ]]; then
    chown postgres:postgres "$PGDATA"
    exec gosu postgres "$0" "$@"
  fi
  # A failed initialization must not be mistaken for a ready database.
  if [[ -e "$PGDATA/.dt-snapshot-initializing" ]]; then
    echo 'Snapshot initialization was interrupted; use a fresh disposable data volume.' >&2
    exit 1
  fi
  touch "$PGDATA/.dt-snapshot-initializing"
  cp -a /opt/dt-seed/. "$PGDATA/"
  chmod 0700 "$PGDATA"
  pg_ctl -D "$PGDATA" -o "-c listen_addresses='' -k /tmp" -w start
  trap 'pg_ctl -D "$PGDATA" -m fast -w stop >/dev/null 2>&1 || true' EXIT
  psql -h /tmp -U postgres -d postgres -v ON_ERROR_STOP=1 \
    --set=username="${POSTGRES_USER:-postgres}" --set=password="$POSTGRES_PASSWORD" \
    --set=database="${POSTGRES_DB:-${POSTGRES_USER:-postgres}}" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN SUPERUSER', :'username') WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'username') \gexec
SELECT format('ALTER ROLE %I PASSWORD %L', :'username', :'password') \gexec
-- The stock postgres database already exists. Replace it with the captured DB
-- only after disconnecting this administrative session to template1 below.
SQL
  psql -h /tmp -U postgres -d template1 -v ON_ERROR_STOP=1 \
    --set=database="${POSTGRES_DB:-${POSTGRES_USER:-postgres}}" <<'SQL'
SELECT format('DROP DATABASE %I', :'database') WHERE :'database' <> 'dt_snapshot' AND EXISTS (SELECT FROM pg_database WHERE datname = :'database') \gexec
SELECT format('ALTER DATABASE dt_snapshot RENAME TO %I', :'database') WHERE :'database' <> 'dt_snapshot' \gexec
SQL
  pg_ctl -D "$PGDATA" -m fast -w stop
  trap - EXIT
  rm "$PGDATA/.dt-snapshot-initializing"
fi
# A copied but interrupted PGDATA must not skip the initialization guard.
if [[ -e "$PGDATA/.dt-snapshot-initializing" ]]; then
  echo 'Snapshot initialization was interrupted; use a fresh disposable data volume.' >&2
  exit 1
fi
exec docker-entrypoint.sh "$@"
