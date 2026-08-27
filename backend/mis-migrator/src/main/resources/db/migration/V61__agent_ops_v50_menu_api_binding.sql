-- ===========================================================================
-- V61__agent_ops_v50_menu_api_binding.sql —— 补 V50 三端点的 sys_menu_api
-- PostgreSQL 16 | 库名: mis_platform
-- 前置：V50 已写 sys_api 92173–92175；V51 已绑 builder/chat；V60 为最新。
--
-- 根因：BFF 注册表 = sys_api ⋈ sys_menu_api ⋈ sys_menu（INNER JOIN）。
--   V50 只插了 sys_api，没有菜单绑定 → findRegistryRows() 匹配为空
--   → deny-unmapped=true → 40300「接口未授权映射」。
--   实测：POST /api/v1/agent-ops/skills/parse。
--
-- 内容（1 api → 1 menu，permission 取自菜单）：
--   92173 技能解析     → 92051 agent:skill:manage（与 create/builder/chat 同族）
--   92174 会话单轮耗时 → 92033 agent:session:list（只读，与会话列表同族）
--   92175 批量会话耗时 → 92033 agent:session:list
--
-- 段位：sys_menu_api.id 与 api_id 同号 92173–92175。
--   V20 用到 92100–92157；V29 92158–92159；V51 92176；92173–92175 空闲。
--
-- 幂等：固定 ID + WHERE NOT EXISTS；不得修改已发布 V1–V60。
-- ===========================================================================

INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (92173, 92051, 92173, 6, NOW()),
    (92174, 92033, 92174, 4, NOW()),
    (92175, 92033, 92175, 5, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (
    SELECT 1 FROM sys_menu_api ma WHERE ma.menu_id = v.menu_id AND ma.api_id = v.api_id
  )
  AND EXISTS (SELECT 1 FROM sys_menu m WHERE m.id = v.menu_id)
  AND EXISTS (SELECT 1 FROM sys_api  a WHERE a.id = v.api_id);


-- ---------------------------------------------------------------------------
-- 迁移后自检
--
--   SELECT a.id, a.http_method, a.path_pattern, m.permission
--   FROM sys_api a
--   JOIN sys_menu_api ma ON ma.api_id = a.id
--   JOIN sys_menu m ON ma.menu_id = m.id
--   WHERE a.id IN (92173, 92174, 92175)
--   ORDER BY a.id;
--   -- 期望 3 行：
--   --   92173 POST /api/v1/agent-ops/skills/parse          agent:skill:manage
--   --   92174 GET  /api/v1/agent-ops/sessions/{id}/timing  agent:session:list
--   --   92175 POST /api/v1/agent-ops/sessions/timing/batch agent:session:list
--
--   -- 行为：有 agent:skill:manage 的登录用户 POST /api/v1/agent-ops/skills/parse
--   -- 应变为 200（非 40300「接口未授权映射」）。
--   -- BFF 需重启，或等 mis.api-permission.refresh-interval-seconds（默认 300s）重载。
-- ---------------------------------------------------------------------------
