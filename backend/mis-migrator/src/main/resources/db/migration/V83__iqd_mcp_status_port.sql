-- V83：问数连接多连接 MCP 可观测字段（方案 A）
-- 每个 IQD 连接对应一个独立 wren serve mcp 进程；进程管理器（ai-platform Worker
-- 侧 WrenMcpProcessManager）按连接分配端口并回写状态/端口，供前端轮询展示。
-- projectHome 由 connId 约定派生（{wren_projects_root}/{connId}），不新增存储列。

ALTER TABLE iqd_connection
    ADD COLUMN IF NOT EXISTS mcp_status VARCHAR(32);

ALTER TABLE iqd_connection
    ADD COLUMN IF NOT EXISTS mcp_port INTEGER;

COMMENT ON COLUMN iqd_connection.mcp_status IS 'WrenAI MCP 进程状态：running/stopped/starting/crashed/unhealthy';
COMMENT ON COLUMN iqd_connection.mcp_port IS 'WrenAI MCP 进程监听端口（进程管理器从端口段分配）';

-- 初始默认值：尚无进程时为 stopped（进程管理器拉起后回写为 running）
UPDATE iqd_connection
SET mcp_status = 'stopped'
WHERE mcp_status IS NULL;
