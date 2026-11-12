-- V85：问数连接跨机器部署引用字段（方案 A 落地版，v0.2）
-- ai-platform 经 WrenMcpAgentClient.ensure 在 wren 机拉起 wren serve mcp 后，把部署
-- 句柄写回 iqd_connection，供前端/可观测定位跨机器部署位置。仅存引用，绝不存凭证明文
-- （决策 ③ S1：wren 机不接 Vault，凭证仅经控制面一次性推送注入子进程 env）。
--
--   mcp_host     VARCHAR(255)  agent 数据面可达 host（ai-platform 侧视角，如 http://10.x:9101）
--   agent_handle VARCHAR(128)  WrenMcpAgent 部署句柄（control 通道路由定位）
-- mcp_status / mcp_port 已在 V83 新增，本文件不重复。
--
-- 幂等：ADD COLUMN IF NOT EXISTS + 默认 ''；可重复执行（Flyway 仅首次应用）。

ALTER TABLE iqd_connection
    ADD COLUMN IF NOT EXISTS mcp_host VARCHAR(255);

ALTER TABLE iqd_connection
    ADD COLUMN IF NOT EXISTS agent_handle VARCHAR(128);

COMMENT ON COLUMN iqd_connection.mcp_host IS 'WrenAI MCP 数据面可达 host（ai-platform 侧视角；跨机器部署引用，不存凭证）';
COMMENT ON COLUMN iqd_connection.agent_handle IS 'WrenMcpAgent 部署句柄（control 通道路由定位；跨机器部署引用，不存凭证）';

-- 初始默认值：尚无跨机器部署时为 ''（本地 Plan A 子进程模型或尚未 ensure）
UPDATE iqd_connection
SET mcp_host = ''
WHERE mcp_host IS NULL;

UPDATE iqd_connection
SET agent_handle = ''
WHERE agent_handle IS NULL;
