-- ===========================================================================
-- V48__recon_api_registry.sql —— 对账平台（recon）BFF 透传端点 authOnly 登记
-- PostgreSQL 16 | 库名: mis_platform
-- 背景：方案 A（recon 前端统一走 Gateway → BFF → recon-service，不再直连 8110）
--       recon 端点在 BFF 以 /api/v1/recon/** 透传；BFF 的 ApiPermissionInterceptor
--       fail-closed（deny-unmapped: true），未登记路径一律 403「接口未授权映射」，
--       故必须登记，否则 recon 前端所有调用全部 403。
--
-- 【为什么是 authOnly 通配而不是逐端点登记】
--   * recon-service 是独立成熟业务系统（11 个 Controller / 数十端点），BFF 对它
--     零加工（ReconProxyController 原样透传）。逐端点登记意味着每次 recon 加端点
--     都要同步改平台迁移，违背「BFF 不参与的端点一律原样转发」的透传策略。
--   * 按钮级权限由 recon 前端 PermissionGate 基于壳子下发的 permissions 控制
--     （方案 A 决策：BFF 只保证「已登录」，不做按钮级 API 鉴权）。
--   * authOnly 由 ApiService.registry() 原生派生：permission 为空 → authOnly=true
--     （ApiService.java:38），零新机制。AntPathMatcher 支持 `**` 通配，
--     4 条（GET/POST/PUT/DELETE）即可覆盖全部 recon 端点。
--
-- 【A 段：段位选取依据（V47 为当前最新，全库实测 grep）】
--   sys_module  93020 —— 现有 1-6 / 91020(kb) / 92020(agent)，93 段空闲
--   sys_menu    93030 —— 目录节点（type=1, visible=0，仅作 sys_menu_api 挂载点，
--                        不进侧栏；recon 侧栏由 remote 应用自身导航提供）
--   sys_api     93090  catalog 根 + 93091-93094 叶子 —— 93 段空闲
--   sys_api.code 00930001-00930004 —— 93 段空闲
--   sys_menu_api 93091-93094 —— 与 api_id 同号，人工比对时一眼对齐
--
-- 【schema 陷阱（V20/V33 已踩，逐条规避）】
--   D5  V8 已 DROP sys_api.tenant_id/app_id，列清单**没有**这两列。
--   D12 sys_api.type 是枚举 sys_api_node_type('catalog','api')，需显式 ::cast。
--   D13 uk_api_method_path (V1:290) UNIQUE (http_method, path_pattern)
--       WHERE type='api' AND status=1 ⇒ (method,path) 全局唯一，4 条两两不重。
--   uk_api_module_code(module_id, code) ⇒ catalog 与叶子 code 在模块内不重。
--   sys_menu: uk_menu_app_code(app_id, code)、uk_menu_app_permission(app_id, permission)
--       WHERE permission IS NOT NULL —— permission 置 NULL 不占名额。
--
-- 幂等：固定 ID + WHERE NOT EXISTS + 父行存在性检查 + (method,path) 去重，可重复执行。
-- 约束：append-only，不得修改 V1–V47。
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. sys_module：对账平台模块（service_name 唯一，V19 同款写法）
-- ---------------------------------------------------------------------------
INSERT INTO sys_module (id, code, name, service_name, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (93020, 'recon', '对账平台', 'recon-service', 12, 1, NOW(), NOW())
) AS v(id, code, name, service_name, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_module WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_module WHERE code = 'recon')
  AND NOT EXISTS (SELECT 1 FROM sys_module WHERE service_name = 'recon-service');

-- ---------------------------------------------------------------------------
-- 2. sys_menu：不可见目录节点（仅作 sys_menu_api 挂载点；recon 侧栏由 remote 自身导航提供）
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (93030, 1, 4, 0, 'recon-api', '对账平台 API', 1, NULL, NULL, NULL, NULL, 1, 0, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu WHERE app_id = 4 AND code = 'recon-api')
  AND EXISTS (SELECT 1 FROM sys_app WHERE id = 4);

-- ---------------------------------------------------------------------------
-- 3. sys_api：catalog 根 + 4 条 authOnly 通配叶子
-- ---------------------------------------------------------------------------
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (93090, 93020, 0, '0093', 'catalog'::sys_api_node_type, '对账平台 API', NULL::VARCHAR, NULL::VARCHAR, 93, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api WHERE module_id = 93020 AND code = v.code)
  AND EXISTS (SELECT 1 FROM sys_module WHERE id = 93020);

INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (93091, 93020, 93090, '00930001', 'api'::sys_api_node_type, '对账查询（authOnly 通配）', 'GET',    '/api/v1/recon/**', 1, 1, NOW(), NOW()),
    (93092, 93020, 93090, '00930002', 'api'::sys_api_node_type, '对账新建（authOnly 通配）', 'POST',   '/api/v1/recon/**', 2, 1, NOW(), NOW()),
    (93093, 93020, 93090, '00930003', 'api'::sys_api_node_type, '对账更新（authOnly 通配）', 'PUT',    '/api/v1/recon/**', 3, 1, NOW(), NOW()),
    (93094, 93020, 93090, '00930004', 'api'::sys_api_node_type, '对账删除（authOnly 通配）', 'DELETE', '/api/v1/recon/**', 4, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api WHERE module_id = 93020 AND code = v.code)
  AND NOT EXISTS (
    SELECT 1 FROM sys_api a
    WHERE a.type = 'api' AND a.status = 1
      AND a.http_method = v.http_method AND a.path_pattern = v.path_pattern
  )
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 93090);

-- ---------------------------------------------------------------------------
-- 4. sys_menu_api：接口 ⇄ 菜单 关联（缺了这张表规则行不进注册表，V20 文件头已述）
--    menu 93030 permission=NULL ⇒ 注册表行 permission 为空 ⇒ authOnly=true
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (93091, 93030, 93091, 1, NOW()),
    (93092, 93030, 93092, 2, NOW()),
    (93093, 93030, 93093, 3, NOW()),
    (93094, 93030, 93094, 4, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE menu_id = v.menu_id AND api_id = v.api_id)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = v.menu_id)
  AND EXISTS (SELECT 1 FROM sys_api  WHERE id = v.api_id);

-- ---------------------------------------------------------------------------
-- 迁移后自检（flyway migrate 后手工跑一遍）
--   -- 1) 4 条规则已登记且 permission 为空（authOnly 派生前提）
--   SELECT a.id, a.http_method, a.path_pattern, m.permission
--   FROM sys_api a
--   JOIN sys_menu_api ma ON ma.api_id = a.id
--   JOIN sys_menu m      ON ma.menu_id = m.id
--   WHERE a.module_id = 93020 AND a.type = 'api' AND a.status = 1;
--   -- 2) BFF 注册表能拉到 4 条（authOnly=true）：GET /internal/v1/api-permissions/registry
--   --    应出现 4 行 path_pattern='/api/v1/recon/**'、permission=null、authOnly=true
-- ===========================================================================
