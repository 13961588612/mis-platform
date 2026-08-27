-- ===========================================================================
-- V50__agent_ops_sessions_timing_and_skill_parse_api.sql —— 智能体运营 3 端点补登
-- PostgreSQL 16 | 库名: mis_platform
-- 前置：V49 为最新；本文件为 V50，Flyway 只追加不修改已发布版本。
--
-- 内容：补登记 AgentOpsController 已暴露、但全迁移漏登的 3 个端点（SEC-02 差集盘点回归）：
--   A. sys_api 登记：92173（技能解析 parse）+ 92174（会话单轮耗时）+ 92175（批量会话耗时），
--      module 92020 / code 00920074-00920076，挂 catalog 92090（与 V20/V46 agent-ops 同父）。
--
-- 说明：这 3 个端点（controller #10 parse / A-5 单轮耗时 / A-6 批量耗时）此前未写入任何迁移，
--   属真实安全注册缺口；id 取 92173-92175（92100-92172 已被 V20/V29/V36/V43/V46 占用，
--   其中 92159 被 V29 的 mcp/tools/cleanup-offline 占用、92160-92168 被 V36 catalog 占用），
--   列顺序/类型/守卫对齐 V20/V46（无 tenant_id/app_id）。
--
-- 幂等：固定 ID + WHERE NOT EXISTS + 同 (http_method, path_pattern) 守卫；重复执行安全。
-- ===========================================================================

INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (92173, 92020, 92090, '00920074', 'api'::sys_api_node_type, '技能解析',     'POST', '/api/v1/agent-ops/skills/parse',          61, 1, NOW(), NOW()),
    (92174, 92020, 92090, '00920075', 'api'::sys_api_node_type, '会话单轮耗时', 'GET',  '/api/v1/agent-ops/sessions/{id}/timing',  62, 1, NOW(), NOW()),
    (92175, 92020, 92090, '00920076', 'api'::sys_api_node_type, '批量会话耗时', 'POST', '/api/v1/agent-ops/sessions/timing/batch', 63, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api WHERE module_id = v.module_id AND code = v.code)
  AND NOT EXISTS (
    SELECT 1 FROM sys_api a
    WHERE a.type = 'api' AND a.status = 1
      AND a.http_method = v.http_method AND a.path_pattern = v.path_pattern
  )
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 92090);

-- ---------------------------------------------------------------------------
-- 迁移后自检（flyway migrate 后手工跑一遍）
--
--   -- 1) 三条新端点已登记且父节点正确（均挂 catalog 92090 智能体运营）
--   SELECT a.id, a.http_method, a.path_pattern, a.parent_id, a.code
--   FROM sys_api a
--   WHERE a.id IN (92173, 92174, 92175) AND a.type = 'api'
--   ORDER BY a.id;
--   -- 期望：3 行；parent_id 均为 92090
--
--   -- 2) (module_id, code) 无重复
--   SELECT module_id, code, count(*) FROM sys_api
--   WHERE id IN (92173, 92174, 92175)
--   GROUP BY module_id, code HAVING count(*) > 1;
--   -- 期望：0 行
--
--   -- 3) (http_method, path_pattern) 全局唯一
--   SELECT http_method, path_pattern, count(*) FROM sys_api
--   WHERE id IN (92173, 92174, 92175)
--   GROUP BY http_method, path_pattern HAVING count(*) > 1;
--   -- 期望：0 行
-- ---------------------------------------------------------------------------
