#!/usr/bin/env bash
# T03d 门禁 1：typecheck + vitest（iqd 批）。
set -u
cd /d/code/mis-platform/frontend/mis-admin-web || exit 9

npm run typecheck > t-tc.out 2>&1
echo "TYPECHECK_EXIT=$?" >> t-tc.out

./node_modules/.bin/vitest run src/features/agent/iqd > t-vt-iqd.out 2>&1
echo "IQD_EXIT=$?" >> t-vt-iqd.out
tail -20 t-vt-iqd.out > t-vt-iqd-tail.out
