-- ===========================================================================
-- V33__kb_security_sprint_authonly.sql —— AI 反向信任端点 authOnly 登记（U1 裁决）
-- PostgreSQL 16 | 库名: mis_platform
-- 设计：docs/backend/mis-kb-security-sprint-design-2026-08-12.md（§1.3 Q3 + U1）
-- PRD ：deliverables/software-company/kb-security-sprint-prd-2026-08-12.md（R3 / Q3）
-- 前置：V32 为当前最新版本；本文件为 V33，Flyway 只追加不修改已发布版本。
--
-- 内容一段：
--   A. sys_api 登记 2 个 AI 反向信任端点（POST /api/v1/ai/skill/execute|apply）
--      + sys_menu_api 关联到 permission=NULL 的既有菜单（V21 建的 92200「AI 技能执行权」目录）
--      + 零 DDL。
--
-- 【为什么是 authOnly（最小豁免，不新建机制）】
--   * ReverseTrustInterceptor 以 @Order(HIGHEST_PRECEDENCE) 先于 ApiPermissionInterceptor
--     执行，双因子校验（X-Platform-Token + 委托 JWT + 网段）通过后写入
--     LoginUser(permissions={"ai:*:use"}) 并放行到 PEP。
--   * 这两个端点的**真实鉴权粒度在 body 的 skill_id**（SkillPermissionChecker 拼
--     ai:skill:{id}:run 判权，fail-closed），URL 级挂任何单一权限码都无法表达技能粒度；
--     V21 刻意不做 URL 级登记即为此因（impl-plan §4.3 附注 #59/#60）。
--   * fail-closed（prod 已 deny-unmapped: true）下未映射路径在 PEP 直接 403，
--     反向信任链路断裂。正确登记形态 = **authOnly（登录即可调、不做 URL 权限码）**，
--     让请求到达 Controller，再由 SkillPermissionChecker 做技能级 fail-closed。
--   * authOnly 由 ApiService.registry() 原生派生：permission 为空 → authOnly=true
--     （ApiService.java:38），零新机制。
--
-- 【挂载菜单 92200 说明】
--   V21 建的「AI 技能执行权」目录（type=1, permission=NULL, visible=0, app_id=1,
--   status=1）。permission 为 NULL ⇒ 不占 uk_menu_app_permission 名额；
--   sys_menu_api 关联后注册表行 permission=NULL ⇒ BFF 侧 authOnly。
--   本文件**不新增任何 sys_menu / sys_role_permission 行**。
--
-- 【A 段：段位选取依据（V32 末段顺延，全库实测 grep）】
--   sys_api      91153 - 91154      —— V32 用到 91125-91152，本文件顺延
--   sys_api.code 00900069-00900070  —— V32 用到 00900041-00900068，本文件顺延
--   sys_menu_api 91253 - 91254      —— V32 用到 91225-91252，本文件顺延
--   sort         78 - 79            —— V32 用到 50-77，本文件顺延
--
-- 幂等：固定 ID + WHERE NOT EXISTS + (method, path) 去重 + ON CONFLICT DO NOTHING，
--       可重复执行。约束：不得修改已发布的 V1-V32。
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A. sys_api 登记 2 个 AI 反向信任端点（module_id=6 AI 能力，parent=6000 V6 catalog）
--    path_pattern 逐字登记（无路径变量）。
-- ---------------------------------------------------------------------------
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (91153, 6, 6000, '00900069', 'api'::sys_api_node_type, '执行 AI 技能（反向信任 authOnly）', 'POST', '/api/v1/ai/skill/execute', 78, 1, NOW(), NOW()),
    (91154, 6, 6000, '00900070', 'api'::sys_api_node_type, '应用 AI 技能（反向信任 authOnly）', 'POST', '/api/v1/ai/skill/apply',   79, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api WHERE module_id = v.module_id AND code = v.code)
  AND NOT EXISTS (
    SELECT 1 FROM sys_api a
    WHERE a.type = 'api' AND a.status = 1
      AND a.http_method = v.http_method AND a.path_pattern = v.path_pattern
  )
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 6000);

-- ---------------------------------------------------------------------------
-- A.2 sys_menu_api 关联：接口 → permission=NULL 的既有目录 92200（authOnly 派生）
--     uk_menu_api_pair(menu_id, api_id) 守卫；V8 已 DROP uk_menu_api_api(api_id)。
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (91253, 92200, 91153, 1, NOW()),
    (91254, 92200, 91154, 1, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE menu_id = v.menu_id AND api_id = v.api_id)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = v.menu_id)
  AND EXISTS (SELECT 1 FROM sys_api  WHERE id = v.api_id);

-- ---------------------------------------------------------------------------
-- 迁移后自检（在你方环境执行 flyway migrate 后手工跑一遍）
--
--   -- 1) 2 个端点已登记且 permission 为空（authOnly 派生前提）
--   SELECT a.id, a.http_method, a.path_pattern, m.permission
--   FROM sys_api a
--   JOIN sys_menu_api ma ON ma.api_id = a.id
--   JOIN sys_menu m      ON ma.menu_id = m.id
--   WHERE a.id BETWEEN 91153 AND 91154
--   ORDER BY a.id;
--   -- 期望：91153 POST /api/v1/ai/skill/execute | NULL
--   --       91154 POST /api/v1/ai/skill/apply   | NULL
--
--   -- 2) 一码一菜单回归：每个 api 只挂一个菜单
--   SELECT api_id, count(*) FROM sys_menu_api
--   WHERE api_id BETWEEN 91153 AND 91154
--   GROUP BY api_id HAVING count(*) > 1;
--   -- 期望：0 行
--
--   -- 3) uk_menu_app_permission 冲突回归：92200 目录 permission 为 NULL，不参与该索引
--   SELECT 1 FROM sys_menu WHERE id = 92200 AND permission IS NOT NULL;
--   -- 期望：0 行
--
--   -- 4) 幂等回归：重复执行本文件后 1) 仍是 2 行、2)/3) 仍是 0 行
--
--   -- 5) 行为验收：ReverseTrustInterceptor 校验通过后 POST /api/v1/ai/skill/execute
--   --    到达 Controller，由 SkillPermissionChecker 按 body skill_id 做技能级 fail-closed；
--   --    反向信任校验失败 / 未登录 期望 401/403（BFF 重启或等注册表 300s 重载）。
-- ---------------------------------------------------------------------------
