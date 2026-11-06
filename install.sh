#!/bin/sh
# Install and start dt in one go:
#   curl -fsSL https://raw.githubusercontent.com/merv-gh/dev-tool/main/install.sh | sh
#   curl -fsSL .../install.sh | sh -s -- --home ~/work/dt --tools-only
# Options: --home DIR (config + data, default ~/dt)   --dir DIR (code, default ~/.dev-tool)
#          --no-webui (keep supporting services)   --tools-only (only dt)   --ref BRANCH|TAG   --no-start
# Run it again to update the code and restart; your config folder is never overwritten.
set -e
# Self-contained because this entry point is also piped directly into sh.
INSTALL_PHASE=options
install_phase() {
  case "$INSTALL_PHASE:$1" in options:preflight|preflight:checkout|checkout:config|config:starting|config:ready|starting:waiting|waiting:ready|waiting:unhealthy) INSTALL_PHASE=$1 ;;
    *) echo "invalid install transition $INSTALL_PHASE -> $1" >&2; exit 1 ;;
  esac
}
REPO=${DT_REPO:-https://github.com/merv-gh/dev-tool.git}
REF=${DT_REF:-main}
CODE=${DT_CODE_DIR:-$HOME/.dev-tool}
HOME_DIR=${DT_HOME:-$HOME/dt}
RUN_ARGS=
START=1
while [ $# -gt 0 ]; do
  case "$1" in
    --home) HOME_DIR=$2; shift 2 ;;
    --dir) CODE=$2; shift 2 ;;
    --ref) REF=$2; shift 2 ;;
    --repo) REPO=$2; shift 2 ;;
    --tools-only) RUN_ARGS="$RUN_ARGS --tools-only"; shift ;;
    --no-webui) RUN_ARGS="$RUN_ARGS --no-webui"; shift ;;
    --no-start) START=; shift ;;
    *) echo "unknown option $1" >&2; exit 1 ;;
  esac
done
install_phase preflight
for c in git docker; do command -v $c >/dev/null 2>&1 || { echo "dt needs $c" >&2; exit 1; }; done
docker compose version >/dev/null 2>&1 || { echo "dt needs docker compose v2" >&2; exit 1; }
install_phase checkout

if [ -d "$CODE/.git" ]; then
  echo "updating $CODE"
  git -C "$CODE" fetch --depth 1 origin "$REF" && git -C "$CODE" checkout -q FETCH_HEAD
else
  echo "cloning $REPO ($REF) into $CODE"
  git clone -q --depth 1 --branch "$REF" "$REPO" "$CODE"
fi

install_phase config
mkdir -p "$HOME_DIR"
FRESH=
[ -f "$HOME_DIR/config.json" ] || [ -f "$HOME_DIR/envs.json" ] || { cp "$CODE/config.example.json" "$HOME_DIR/config.json"; FRESH=1; }
[ -f "$HOME_DIR/.env" ] || [ -f "$HOME_DIR/.env.personal" ] || { cp "$CODE/.env.example" "$HOME_DIR/.env"; chmod 600 "$HOME_DIR/.env"; FRESH=1; }

if [ -n "$START" ]; then
  install_phase starting
  "$CODE/run.sh" --home "$HOME_DIR" $RUN_ARGS up -d
  install_phase waiting
  printf 'waiting for dt'
  i=0; until curl -fsS -o /dev/null http://127.0.0.1:${DT_PORT:-4000}/health 2>/dev/null; do i=$((i+1)); [ $i -gt 60 ] && { install_phase unhealthy; break; }; printf .; sleep 2; done; echo
  if [ "$INSTALL_PHASE" = unhealthy ]; then
    echo "dt did not become healthy; inspect $CODE/run.sh --home $HOME_DIR logs dt" >&2
    exit 1
  fi
fi
install_phase ready

cat <<MSG

dt code:    $CODE
config:     $HOME_DIR/config.json   (structure, editable on /admin)
secrets:    $HOME_DIR/.env          (passwords, tokens, compose settings)
admin:      http://127.0.0.1:${DT_PORT:-4000}/admin
MSG
PROFILES=$(sed -n "s/^COMPOSE_PROFILES=//p" "$HOME_DIR/.env" 2>/dev/null)
[ -z "$RUN_ARGS" ] && case "${COMPOSE_PROFILES-${PROFILES-webui}}" in *webui*) echo "chat:       http://127.0.0.1:${WEBUI_PORT:-3000}" ;; esac
[ -n "$FRESH" ] && cat <<MSG

New config created from the examples. Fill in $HOME_DIR/.env and $HOME_DIR/config.json
(or edit config.json on /admin), then press "Refresh everything" on /admin.
MSG
cat <<MSG

Manage:     $CODE/run.sh --home $HOME_DIR [--no-webui|--tools-only] ps | logs -f dt | restart dt | down
MSG
