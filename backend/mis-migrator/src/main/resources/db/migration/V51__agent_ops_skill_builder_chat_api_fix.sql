-- ===========================================================================
-- V51__agent_ops_skill_builder_chat_api_fix.sql —— 补登 builder/chat 被跳过的 sys_api
-- PostgreSQL 16 | 库名: mis_platform
-- 前置：V50 为最新；本文件为 V51，Flyway 只追加不修改已发布版本。
--
-- ---------------------------------------------------------------------------
-- 【本次修复背景 —— V29 与 V46 的 id 碰撞导致 builder/chat 漏登】
--   V29__agent_mcp_tool_permissions.sql 与 V46__agent_ops_skill_builder_perms.sql
--   都向 sys_api 写入 id = 92158（V29 是 GET /api/v1/agent-ops/mcp/tools，
--   code='00920059'；V46 是 POST /api/v1/agent-ops/skills/builder/chat，
--   code='00920059'），且各自都带 `WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)`。
--
--   Flyway 严格按版本号顺序执行，V29（序号在前）先跑并占住 92158；V46 后跑时
--   `NOT EXISTS(id=92158)` 为 false ⇒ builder/chat 的 sys_api 行被**静默跳过**
--   （不报 PK 错，只是没插入）；其 sys_menu_api (92158,92051,92158) 也因 id 92158
--   已被 V29 的 sys_menu_api 占住而跳过。
--
--   结果：POST /api/v1/agent-ops/skills/builder/chat **无 sys_api 登记、无菜单绑定**
--   ⇒ BFF `api-permission.deny-unmapped=true` ⇒ 运行时 403（正是 V46 文件头自己
--   警告的情形）。
--
--   约束：V29 与 V46 已在服务器运行，Flyway 会因校验和变化拒绝启动，**严禁修改**。
--   故本文件用全新的空闲 id 92176 / code 00920077 重新补登该端点，幂等、可重复执行。
--
-- ---------------------------------------------------------------------------
-- 【ID / code 段位】
--   92176   sys_api    接口行，code='00920077'，sort=64，父节点 92090（智能体运营 catalog）
--   92176   sys_menu_api 关联行（与 api_id 同号，便于人工比对）
--   已全量 grep 确认 92176 / 00920077 在 mis-migrator 全仓零命中，且 Agent 域
--   sys_api 已用最大 id=92175（V50），sys_menu_api 的 92xxx 段最大=92172，故 92176 空闲。
--
-- 幂等：固定 ID + WHERE NOT EXISTS + (module_id,code) 去重 + (method,path) 去重；重复执行安全。
-- ===========================================================================

-- 1. sys_api 接口行（type='api'）。id 取 92176，code 取 '00920077'，sort 64，挂 catalog 92090。
--    ⚠️ 列清单**没有** tenant_id / app_id —— V8 已 DROP（同 V20 文件头 D5）。
--    每行带 (id) / (module_id,code) / (method,path) 三重相关子查询去重，重复执行安全。
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (92176, 92020, 92090, '00920077', 'api'::sys_api_node_type, 'AI 对话创建技能', 'POST', '/api/v1/agent-ops/skills/builder/chat', 64, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api WHERE module_id = v.module_id AND code = v.code)
  AND NOT EXISTS (
    SELECT 1 FROM sys_api a
    WHERE a.type = 'api' AND a.status = 1
      AND a.http_method = v.http_method
      AND a.path_pattern = v.path_pattern
  )
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 92090);

-- 2. sys_menu_api 关联：挂在菜单 92051（agent:skill:manage）下，permission 由菜单侧提供。
--    id 与 api_id 同号（92176），人工比对一眼对齐；逐对去重，重复执行安全。
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (92176, 92051, 92176, 1, NOW())
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
--   -- 0) 本模块 (method, path) 不应与既有行重复（含与全库比对）
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
--   WHERE a.id = 92176;
--   -- 期望：1 行，permission='agent:skill:manage'，module_status=1
--
--   -- 2) (module_id, code) 无重复
--   SELECT module_id, code, count(*) FROM sys_api
--   WHERE id = 92176
--   GROUP BY module_id, code HAVING count(*) > 1;
--   -- 期望：0 行
--
--   -- 3) 行为验收：无 agent:skill:manage 的登录用户
--   --    POST /api/v1/agent-ops/skills/builder/chat 期望 403；
--   --    BFF 需重启，或等 mis.api-permission.refresh-interval-seconds 到期重载注册表。
-- ---------------------------------------------------------------------------
