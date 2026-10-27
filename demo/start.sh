#!/bin/sh
# A complete local demo: Postgres in Docker + demo/mock.js (Consul, ES, ELK, kafka-ui, Bitbucket with real
# git repos) + dt on :4800 with its config in demo/.home. Then: open http://127.0.0.1:4800/admin
#   sh demo/start.sh          sh demo/stop.sh
set -e
cd "$(dirname "$0")/.."
H=$(pwd)/demo/.home
MOCK=${MOCK_PORT:-4900}; DT=${DT_DEMO_PORT:-4800}; PGP=${DEMO_PG_PORT:-55433}
mkdir -p "$H"
if ! docker ps --format '{{.Names}}' | grep -qx dt-demo-pg; then
  docker rm -f dt-demo-pg >/dev/null 2>&1 || true
  docker run -d --name dt-demo-pg -e POSTGRES_PASSWORD=demo -e POSTGRES_DB=orders -p 127.0.0.1:$PGP:5432 postgres:16-alpine >/dev/null
  until docker exec dt-demo-pg pg_isready -U postgres -d orders >/dev/null 2>&1; do sleep 1; done
  sleep 1
fi
docker exec -i dt-demo-pg psql -q -U postgres -d orders < demo/seed.sql

cat > "$H/config.json" <<JSON
{
  "envs": {
    "demo": {
      "postgres": { "orders": "\${DEMO_ORDERS_DB}" },
      "elasticsearch": { "hosts": ["http://127.0.0.1:$MOCK"] },
      "kafkaUi": "http://127.0.0.1:$MOCK",
      "schemaRegistry": "http://127.0.0.1:$MOCK",
      "consul": "http://127.0.0.1:$MOCK",
      "logs": { "index": "logs-*", "kibana": "http://kibana.example.com" }
    }
  },
  "bitbucket": { "url": "http://127.0.0.1:$MOCK", "token": "\${DEMO_BB_TOKEN}" },
  "passports": { "internalGroups": ["com.acme.libs"] },
  "tools": {
    "custom": [{
      "name": "orders_by_status", "type": "sql", "env": "demo", "db": "orders",
      "description": "Latest orders with a given status.",
      "sql": "select id, customer_id, status, total, created_at from sales.orders where status = :status order by created_at desc limit :limit",
      "params": { "status": { "required": true, "enum": ["new", "paid", "shipped", "closed", "payment_failed"] }, "limit": { "type": "integer", "default": 50 } }
    }]
  },
  "browser": {
    "sites": {
      "shop": {
        "url": "http://\${DEMO_SHOP_HOST:-127.0.0.1}:$MOCK/shop/login", "secrets": ["SHOP_PASSWORD"], "description": "Back office",
        "links": { "order": { "path": "/shop/orders/<orderId>", "description": "One order with its payment" }, "customers": "/shop/customers" }
      }
    }
  },
  "server": { "publicUrl": "http://127.0.0.1:$DT", "ratePerSec": 0 }
}
JSON
printf 'DEMO_ORDERS_DB=postgres://postgres:demo@127.0.0.1:%s/orders\nDEMO_BB_TOKEN=demo\nSHOP_PASSWORD=demo\n' "$PGP" > "$H/.env"
mkdir -p "$H/scripts" && cp -R demo/scripts/. "$H/scripts/"   # example saved scripts
echo '{ "sales.order_audit": "Written only by the orders_status_audit trigger. Kept 90 days." }' > "$H/notes.json"

pkill -f "demo/mock.js" 2>/dev/null || true; pkill -f "cli.js serve --port $DT" 2>/dev/null || true
nohup node demo/mock.js "$MOCK" > "$H/mock.log" 2>&1 &
sleep 1
# browser steps (scripts, routes_discover) use a Playwright MCP container when DEMO_BROWSER=1
if [ "${DEMO_BROWSER:-0}" = 1 ]; then
  docker rm -f dt-demo-browser >/dev/null 2>&1 || true
  docker run -d --name dt-demo-browser -p 127.0.0.1:${DEMO_BROWSER_PORT:-8931}:8931 mcr.microsoft.com/playwright/mcp:v0.0.83 \
    --port 8931 --host 0.0.0.0 --allowed-hosts '*' --isolated >/dev/null
  export DT_BROWSER_MCP=http://127.0.0.1:${DEMO_BROWSER_PORT:-8931}/mcp
  echo DEMO_SHOP_HOST=host.docker.internal >> "$H/.env"   # the browser container reaches the mock on the host
fi
DT_HOME=$H nohup node cli.js serve --port "$DT" > "$H/dt.log" 2>&1 &
until curl -fsS -o /dev/null "http://127.0.0.1:$DT/health" 2>/dev/null; do sleep 0.5; done
DT_HOME=$H node cli.js sync all > /dev/null 2>"$H/sync.log"
DT_HOME=$H node cli.js sync passports --only order-service,payment-service > /dev/null 2>>"$H/sync.log"
echo "demo: http://127.0.0.1:$DT/admin   (stop: sh demo/stop.sh)"
