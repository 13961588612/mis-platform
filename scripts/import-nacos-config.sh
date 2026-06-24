#!/usr/bin/env bash
set -euo pipefail

NAMESPACE="${1:-test}"
GROUP="${NACOS_CONFIG_GROUP:-MIS_GROUP}"
NACOS_SERVER="${NACOS_SERVER:-http://localhost:8848}"
IMPORT_DIR="$(cd "$(dirname "$0")/../deploy/nacos/import" && pwd)"

TOKEN=""
if RESP=$(curl -sf -X POST "$NACOS_SERVER/nacos/v1/auth/login" \
  -d "username=nacos&password=nacos" 2>/dev/null); then
  TOKEN=$(echo "$RESP" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
fi

CURL_AUTH=()
if [[ -n "$TOKEN" ]]; then
  CURL_AUTH=(-H "Authorization: Bearer $TOKEN")
fi

for f in "$IMPORT_DIR"/*.yaml; do
  data_id=$(basename "$f")
  content=$(cat "$f")
  curl -sf -X POST "$NACOS_SERVER/nacos/v1/cs/configs" \
    "${CURL_AUTH[@]}" \
    --data-urlencode "dataId=$data_id" \
    --data-urlencode "group=$GROUP" \
    --data-urlencode "tenant=$NAMESPACE" \
    --data-urlencode "type=yaml" \
    --data-urlencode "content=$content" >/dev/null
  echo "Imported $data_id -> namespace=$NAMESPACE group=$GROUP"
done

echo "Done. Verify at $NACOS_SERVER/nacos"
