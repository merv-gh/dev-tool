#!/bin/sh
# The demo and an end-to-end check in one: starts the demo unless it runs, then shows everything for one
# service on one page: health and dashboards of demo and uat, the service's versions in both, its passport,
# the impact of a method, and a test of that method written and run on master, with its patch.
#   sh demo/showcase.sh                                  payments-service, FeeCalculator#fee, demo's test file
#   sh demo/showcase.sh payments-service PaymentService#settle     the test_context skeleton instead
# Running tests needs Maven and a JDK (mvn on PATH, or DT_MAVEN=/path/to/mvn before the first start).
# Exits non-zero when a step fails.
set -e
cd "$(dirname "$0")/.."
DT=${DT_DEMO_PORT:-4800}
curl -fsS -o /dev/null "http://127.0.0.1:$DT/health" 2>/dev/null || sh demo/start.sh
SERVICE=${1:-payments-service}; TARGET=${2:-FeeCalculator#fee}
TEST=""
if [ -z "$2" ]; then TEST="--test-file demo/showcase/FeeCalculatorTest.java"; fi
# shellcheck disable=SC2086
DT_HOME=$(pwd)/demo/.home node cli.js showcase "$SERVICE" "$TARGET" --envs "${ENVS:-demo,uat}" $TEST
