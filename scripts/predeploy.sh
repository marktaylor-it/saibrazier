#!/usr/bin/env bash
# Run before every push. Refuses to continue on a problem.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "1/3  JavaScript"
./scripts/check-js.sh
echo "2/3  no root-absolute paths"
if grep -rE '(href|src)="/' *.html admin/*.html 2>/dev/null; then
  echo "  FAIL: root-absolute paths 404 on a subpath"; exit 1
fi
echo "  ok"
echo "3/3  asset hashes"
./scripts/stamp-assets.sh
echo "READY"
