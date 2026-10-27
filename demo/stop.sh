#!/bin/sh
pkill -f "demo/mock.js" 2>/dev/null; pkill -f "demo/sftp.js" 2>/dev/null; pkill -f "cli.js serve --port ${DT_DEMO_PORT:-4800}" 2>/dev/null; docker rm -f dt-demo-pg dt-demo-browser >/dev/null 2>&1; echo stopped
