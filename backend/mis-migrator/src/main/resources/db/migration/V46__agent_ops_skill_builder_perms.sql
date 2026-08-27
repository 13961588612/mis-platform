-- MIS Platform — 智能体运营控制台：AI 对话创建技能（C 功能）API 权限登记
-- PostgreSQL 16 | 库名: mis_platform
-- 施工图：docs/agent/skill-ai-create/system_design.md（决策 D/E）
-- 前置：V20__agent_ops_api_perms.sql（sys_api 92090 根节点 + 58 条 + 菜单 92051 agent:skill:manage）
--
-- ---------------------------------------------------------------------------
-- 【为什么必须存在】
--   mis-admin-bff 的 `api-permission.deny-unmapped` 默认 true（未映射即拒绝），
--   而非 V20 文件头假设的 false。因此 `POST /api/v1/agent-ops/skills/builder/chat`
--   若不在此登记，会直接 403（不是「悄悄不判权」）。
--   该端点权限码与新建/编辑技能同族 `agent:skill:manage`（菜单 92051 已建），
--   故仅补 sys_api + sys_menu_api 两行关联即可复用既有按钮码，无需新建菜单节点。
--
-- 【与 C 功能契约对齐】
--   路径 `/api/v1/agent-ops/skills/builder/chat` 与方法 `POST` 与 BFF
--   AgentOpsController.builderChat 的 @PostMapping 逐字一致；
--   下游透传 `POST /api/v1/skills/builder/chat`（ai-platform ephemeral 端点，不落库）。
-- ---------------------------------------------------------------------------

-- 1. sys_api 接口行（type='api'）。id 取 92158，code 取 '00920059'，sort 59，与 V20 的 58 条连续。
--    ⚠️ 列清单**没有** tenant_id / app_id —— V8 已 DROP（同 V20 文件头 D5）。
--   每行带 (method,path) 相关子查询去重，重复执行安全。
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (92158, 92020, 92090, '00920059', 'api'::sys_api_node_type, 'AI 对话创建技能', 'POST', '/api/v1/agent-ops/skills/builder/chat', 59, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api a WHERE a.module_id = 92020 AND a.code = v.code)
  AND NOT EXISTS (
    SELECT 1 FROM sys_api a
    WHERE a.type = 'api' AND a.status = 1
      AND a.http_method = v.http_method
      AND a.path_pattern = v.path_pattern
  )
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 92090);

-- 2. sys_menu_api 关联：挂在菜单 92051（agent:skill:manage）下，permission 由菜单侧提供。
--    id 与 api_id 同号（92158），人工比对一眼对齐；逐对去重，重复执行安全。
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (92158, 92051, 92158, 1, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (
    SELECT 1 FROM sys_menu_api ma WHERE ma.menu_id = v.menu_id AND ma.api_id = v.api_id
  )
  AND EXISTS (SELECT 1 FROM sys_menu m  WHERE m.id = v.menu_id)
  AND EXISTS (SELECT 1 FROM sys_api  a  WHERE a.id = v.api_id);


-- ---------------------------------------------------------------------------
-- 迁移后自检（flyway migrate 后手工跑一遍）
--
--   -- 0) 本模块 (method, path) 不应与既有行重复（含与 V17 全库比对）
--   SELECT http_method, path_pattern, COUNT(*) FROM sys_api
--   WHERE type = 'api' AND status = 1
--   GROUP BY http_method, path_pattern HAVING COUNT(*) > 1;
--   -- 期望：0 行
--
--   -- 1) 注册表视图：本端点应带非空 permission=agent:skill:manage
--   SELECT a.http_method, a.path_pattern, m.permission, sm.status AS module_status
--   FROM sys_api a
--   JOIN sys_menu_api ma ON ma.api_id = a.id
--   JOIN sys_menu m      ON ma.menu_id = m.id
--   JOIN sys_module sm   ON sm.id = a.module_id
--   WHERE a.id = 92158;
--   -- 期望：1 行，permission='agent:skill:manage'，module_status=1
--
--   -- 2) 行为验收：无 agent:skill:manage 的登录用户
--   --    POST /api/v1/agent-ops/skills/builder/chat 期望 403；
--   --    BFF 需重启，或等 mis.api-permission.refresh-interval-seconds 到期重载注册表。
-- ---------------------------------------------------------------------------
