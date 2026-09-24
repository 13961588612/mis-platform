#!/bin/bash
# ? wren ????????????????????
set -euo pipefail
cd /opt/wren-mcp-agent
echo '=== recent journal ==='
journalctl -u wren-mcp-agent -n 40 --no-pager || true
echo '=== try import ==='
.venv/bin/python - <<'PY'
import traceback
try:
    import agent
    print('import ok')
except Exception:
    traceback.print_exc()
PY
