#!/bin/sh
# Install and start dt in one go:
#   curl -fsSL https://raw.githubusercontent.com/merv-gh/dev-tool/main/install.sh | sh
#   curl -fsSL .../install.sh | sh -s -- --home ~/work/dt --tools-only
# Options: --home DIR (config + data, default ~/dt)   --dir DIR (code, default ~/.dev-tool)
#          --tools-only (no Open WebUI/browser/graph)   --ref BRANCH|TAG   --no-start
# Run it again to update the code and restart; your config folder is never overwritten.
set -e
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
    --tools-only) RUN_ARGS="--tools-only"; shift ;;
    --no-start) START=; shift ;;
    *) echo "unknown option $1" >&2; exit 1 ;;
  esac
done
for c in git docker; do command -v $c >/dev/null 2>&1 || { echo "dt needs $c" >&2; exit 1; }; done
docker compose version >/dev/null 2>&1 || { echo "dt needs docker compose v2" >&2; exit 1; }

if [ -d "$CODE/.git" ]; then
  echo "updating $CODE"
  git -C "$CODE" fetch --depth 1 origin "$REF" && git -C "$CODE" checkout -q FETCH_HEAD
else
  echo "cloning $REPO ($REF) into $CODE"
  git clone -q --depth 1 --branch "$REF" "$REPO" "$CODE"
fi

mkdir -p "$HOME_DIR"
FRESH=
[ -f "$HOME_DIR/config.json" ] || [ -f "$HOME_DIR/envs.json" ] || { cp "$CODE/config.example.json" "$HOME_DIR/config.json"; FRESH=1; }
[ -f "$HOME_DIR/.env" ] || [ -f "$HOME_DIR/.env.personal" ] || { cp "$CODE/.env.example" "$HOME_DIR/.env"; chmod 600 "$HOME_DIR/.env"; FRESH=1; }

if [ -n "$START" ]; then
  "$CODE/run.sh" --home "$HOME_DIR" $RUN_ARGS up -d
  printf 'waiting for dt'
  i=0; until curl -fsS -o /dev/null http://127.0.0.1:${DT_PORT:-4000}/health 2>/dev/null; do i=$((i+1)); [ $i -gt 60 ] && break; printf .; sleep 2; done; echo
fi

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

Manage:     $CODE/run.sh --home $HOME_DIR [--tools-only] ps | logs -f dt | restart dt | down
MSG
