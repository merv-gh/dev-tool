#!/bin/sh
# docker compose with settings from .env.personal (COMPOSE_PROFILES, LLM_*, DT_API_KEY).
#   ./run.sh up -d --build     ./run.sh logs -f dt     ./run.sh down
#   COMPOSE_PROFILES= ./run.sh up -d        only the dt tool server
cd "$(dirname "$0")" || exit 1
[ -f .env.personal ] || { echo "missing .env.personal: cp .env.personal.example .env.personal" >&2; exit 1; }
ls .env.* 2>/dev/null | grep -qvE '\.env\.(personal|browser|example)|\.example$' || echo "note: no .env.<env> file yet (cp .env.example .env.dev); dt starts, but has nothing to index" >&2
mkdir -p cache repos passports plugins   # bind mounts: create them as you, not as root
[ -f .env.browser ] || : > .env.browser   # browser container mounts it; empty = no sites
# COMPOSE_PROFILES: from the environment, else .env.personal, else everything
if [ -z "${COMPOSE_PROFILES+set}" ] && ! grep -q '^COMPOSE_PROFILES=' .env.personal; then export COMPOSE_PROFILES=webui,browser,graph; fi
exec docker compose --env-file .env.personal "$@"
