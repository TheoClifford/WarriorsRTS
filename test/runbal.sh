#!/bin/sh
# usage: test/runbal.sh <seeds> <outfile> [seedBase]  — runs the round robin on 2 processes and prints the report
set -e
cd "$(dirname "$0")/.."
npx esbuild test/balance.ts --bundle --platform=node --format=esm --outfile=/tmp/balance.mjs --log-level=warning
rm -f "$2"
node /tmp/balance.mjs "$1" 0 2 "$2" "${3:-5000}" &
node /tmp/balance.mjs "$1" 1 2 "$2" "${3:-5000}"
wait
python3 test/balreport.py "$2"
