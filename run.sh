#!/bin/sh
# docker compose for dt, with config and data in one folder.
#   ./run.sh [--home DIR] [--tools-only] <compose args>
#   ./run.sh --home ~/dt up -d        full stack (profiles from COMPOSE_PROFILES in DIR/.env)
#   ./run.sh --home ~/dt --tools-only up -d   only the dt tool server (for an Open WebUI / MCP client you already run)
#   ./run.sh --home ~/dt logs -f dt           ./run.sh --home ~/dt down
# DIR defaults to $DT_HOME, else this folder. It holds config.json + .env (or the older .env.<env> files).
set -e
cd "$(dirname "$0")"
CODE=$(pwd)
HOME_DIR=${DT_HOME:-$CODE}
TOOLS_ONLY=
while [ $# -gt 0 ]; do
  case "$1" in
    --home) HOME_DIR=$2; shift 2 ;;
    --home=*) HOME_DIR=${1#--home=}; shift ;;
    --tools-only) TOOLS_ONLY=1; shift ;;
    *) break ;;
  esac
done
mkdir -p "$HOME_DIR"
HOME_DIR=$(cd "$HOME_DIR" && pwd)

if [ -f "$HOME_DIR/.env" ]; then ENV_FILE=$HOME_DIR/.env
elif [ -f "$HOME_DIR/.env.personal" ]; then ENV_FILE=$HOME_DIR/.env.personal   # older layout
else
  echo "no $HOME_DIR/.env yet. Start from the examples:" >&2
  echo "  cp $CODE/.env.example $HOME_DIR/.env && cp $CODE/config.example.json $HOME_DIR/config.json" >&2
  exit 1
fi
[ -f "$HOME_DIR/config.json" ] || [ -f "$HOME_DIR/envs.json" ] || ls "$HOME_DIR"/.env.* >/dev/null 2>&1 ||
  echo "note: no config.json in $HOME_DIR; dt starts, but has no environments to index" >&2

# bind mounts: create them as you, not as root
mkdir -p "$HOME_DIR/cache" "$HOME_DIR/repos" "$HOME_DIR/passports" "$HOME_DIR/plugins"
[ -f "$HOME_DIR/cache/browser.env" ] || : > "$HOME_DIR/cache/browser.env"

export DT_HOME_DIR="$HOME_DIR"
# run the containers as you, so files in the config folder (repos/, cache/) are yours and git can manage them
[ -n "${DT_UID:-}" ] || grep -q '^DT_UID=' "$ENV_FILE" || export DT_UID=$(id -u)
[ -n "${DT_GID:-}" ] || grep -q '^DT_GID=' "$ENV_FILE" || export DT_GID=$(id -g)
# dt and the build runner share a token (the runner has Docker access: nothing else may send it commands)
if ! grep -q '^DT_RUNNER_TOKEN=' "$ENV_FILE"; then
  printf '\n# dt <-> build runner (written by run.sh)\nDT_RUNNER_TOKEN=%s\n' "$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')" >> "$ENV_FILE"
fi
# the group of the Docker socket as the runner sees it: Docker Desktop 0, a Linux engine its docker group
if [ -z "${DT_DOCKER_GID:-}" ] && ! grep -q '^DT_DOCKER_GID=' "$ENV_FILE"; then
  if docker info --format '{{.OperatingSystem}}' 2>/dev/null | grep -qi 'docker desktop'; then export DT_DOCKER_GID=0
  elif [ -S /var/run/docker.sock ]; then export DT_DOCKER_GID=$(stat -c %g /var/run/docker.sock 2>/dev/null || stat -f %g /var/run/docker.sock)
  fi
fi
if [ -n "$TOOLS_ONLY" ]; then export COMPOSE_PROFILES=
elif [ -z "${COMPOSE_PROFILES+set}" ] && ! grep -q '^COMPOSE_PROFILES=' "$ENV_FILE"; then export COMPOSE_PROFILES=webui,browser,graph,jdk,testdb
fi
exec docker compose --project-directory "$CODE" -f "$CODE/docker-compose.yml" --env-file "$ENV_FILE" "$@"
