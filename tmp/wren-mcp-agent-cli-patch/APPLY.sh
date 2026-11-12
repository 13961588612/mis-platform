# 在 wren 机 (10.254.16.27) 上执行：
sudo cp /opt/wren-mcp-agent/agent.py /opt/wren-mcp-agent/agent.py.bak.$(date +%Y%m%d%H%M%S)
sudo cp ./agent.py /opt/wren-mcp-agent/agent.py
sudo systemctl restart wren-mcp-agent
sleep 2
curl -sf -H "Authorization: Bearer $WREN_AGENT_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"conn_id":"900001","args":["--version"]}' \
  http://127.0.0.1:9100/internal/v1/wren-mcp/cli
