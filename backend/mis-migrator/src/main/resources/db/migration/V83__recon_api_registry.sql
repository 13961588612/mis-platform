-- ===========================================================================
-- V83__recon_api_registry.sql —— 对账平台（recon）BFF 透传端点登记与权限
-- PostgreSQL 16 | 库名: mis_platform
-- 背景：本文件合并原 V48__recon_api_registry 全部注册内容并做三处演进：
--       1) 版本号 V48 与 master 的 V48__employee_builtin_flag 撞号，改 V83；
--       2) sys_menu id 93030 已被 iqd（app=93010）占用，目录改用 93035；
--       3) 【本次】三个配置菜单（连接管理/数据源管理/场景与检查）需要区分
--          权限：无 view 码的用户看不到菜单、也调不了对应 API。故在 4 条
--          authOnly 通配之外，新增配置类细分规则绑定 view 码。
--
-- 【权限模型（页面级）】
--   * recon 三个配置菜单：连接管理 / 数据源管理 / 场景与检查，各挂页面级
--     view 码（recon:connection:view 等）。BFF 对配置类 API 校验 view 码，
--     无码一律 403（页面级拦截，页面内写/删按钮仍由前端 PermissionGate
--     用 write/delete 码控制，后端不细分）。
--   * 查询类（差异查询/报告中心/运行监控）保持 authOnly：登录即可访问。
--   * 机制：registry.match() 同时命中 authOnly 通配与带码规则时"以权限为准"
--     （ApiPermissionRegistry.java:80-84），故保留 GET/POST/PUT/DELETE
--     /api/v1/recon/** 四条 authOnly 通配兜底，再叠加配置类细分规则即可
--     实现"配置类需码、其余 authOnly"，且不会因拆分遗漏端点导致 403。
--
-- 【段位（数据库实测，V82 为当前最新）】
--   sys_module  93020
--   sys_menu    93035 目录 + 93036-93038 页面(view) + 93046-93054 按钮(write/delete/pull/run/confirm)
--   sys_api     93090 catalog + 93091-93094 authOnly 通配 + 93100-93121 配置类细分
--   sys_api.code 0093/00930001-00930004/00930100-00930121
--   sys_menu_api 与 api_id 同号
--
-- 【schema 陷阱（V20/V33 已踩，逐条规避）】
--   D5  V8 已 DROP sys_api.tenant_id/app_id，列清单**没有**这两列。
--   D12 sys_api.type 是枚举 sys_api_node_type('catalog','api')，需显式 ::cast。
--   D13 uk_api_method_path (V1:290) UNIQUE (http_method, path_pattern)
--       WHERE type='api' AND status=1 ⇒ (method,path) 全局唯一，新增规则两两不重。
--   uk_api_module_code(module_id, code) ⇒ catalog/叶子 code 在模块内不重。
--   sys_menu: uk_menu_app_code(app_id, code)、uk_menu_app_permission(app_id, permission)
--       WHERE permission IS NOT NULL —— permission 置 NULL 不占名额。
--   sys_role_permission: uk_role_perm(role_id, perm_type, target_id)（V2 seed 口径）。
--
-- 幂等：固定 ID + WHERE NOT EXISTS + 父行存在性检查 + 授权逐行判重，可重复执行。
-- 约束：append-only，不得修改 V1–V82。
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
-- 2. sys_menu：目录 + 页面(view) + 按钮(write/delete/pull/run/confirm)
--    目录 93035 仅作 sys_menu_api 挂载点（permission=NULL → authOnly 派生）；
--    页面 93036-93038 挂 view 码，供 BFF 页面级拦截 + 壳子侧栏菜单过滤；
--    按钮 93046-93054 挂 write/delete 码，供前端 PermissionGate + 角色授权下发。
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (93035, 1, 4, 0, 'recon-api',            '对账平台 API',       1, NULL, NULL, NULL,                    NULL, 1, 0, 1, NOW(), NOW()),
    (93036, 1, 4, 93035, 'recon_connection', '连接管理',           2, NULL, NULL, 'recon:connection:view',  NULL, 1, 1, 1, NOW(), NOW()),
    (93037, 1, 4, 93035, 'recon_datasource', '数据源管理',         2, NULL, NULL, 'recon:datasource:view',   NULL, 2, 1, 1, NOW(), NOW()),
    (93038, 1, 4, 93035, 'recon_scenario',   '场景与检查',         2, NULL, NULL, 'recon:scenario:view',     NULL, 3, 1, 1, NOW(), NOW()),
    (93046, 1, 4, 93036, 'recon_connection_write',   '连接新建/编辑', 3, NULL, NULL, 'recon:connection:write', NULL, 1, 1, 1, NOW(), NOW()),
    (93047, 1, 4, 93036, 'recon_connection_delete',  '连接删除',      3, NULL, NULL, 'recon:connection:delete',NULL, 2, 1, 1, NOW(), NOW()),
    (93048, 1, 4, 93037, 'recon_datasource_write',   '数据源新建/编辑', 3, NULL, NULL, 'recon:datasource:write', NULL, 1, 1, 1, NOW(), NOW()),
    (93049, 1, 4, 93037, 'recon_datasource_delete',  '数据源删除',      3, NULL, NULL, 'recon:datasource:delete',NULL, 2, 1, 1, NOW(), NOW()),
    (93050, 1, 4, 93037, 'recon_datasource_pull',    '数据源手动拉取',  3, NULL, NULL, 'recon:datasource:pull',  NULL, 3, 1, 1, NOW(), NOW()),
    (93051, 1, 4, 93038, 'recon_scenario_write',     '场景新建/编辑',   3, NULL, NULL, 'recon:scenario:write',   NULL, 1, 1, 1, NOW(), NOW()),
    (93052, 1, 4, 93038, 'recon_scenario_delete',    '场景删除',        3, NULL, NULL, 'recon:scenario:delete',  NULL, 2, 1, 1, NOW(), NOW()),
    (93053, 1, 4, 93038, 'recon_scenario_run',       '场景手动对账',    3, NULL, NULL, 'recon:scenario:run',     NULL, 3, 1, 1, NOW(), NOW()),
    (93054, 1, 4, 93035, 'recon_diff_confirm',       '差异确认',        3, NULL, NULL, 'recon:diff:confirm',     NULL, 4, 1, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu WHERE app_id = 4 AND code = v.code)
  AND EXISTS (SELECT 1 FROM sys_app WHERE id = 4);

-- ---------------------------------------------------------------------------
-- 3. sys_api：catalog 根 + 4 条 authOnly 通配 + 配置类细分规则（view 码）
-- ---------------------------------------------------------------------------
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (93090, 93020, 0, '0093', 'catalog'::sys_api_node_type, '对账平台 API', NULL::VARCHAR, NULL::VARCHAR, 93, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api WHERE module_id = 93020 AND code = v.code)
  AND EXISTS (SELECT 1 FROM sys_module WHERE id = 93020);

-- 3a. authOnly 通配兜底（挂在目录 93035，permission=NULL → authOnly）
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

-- 3b. 配置类细分规则（叠加在通配之上；命中时带码规则优先，见文件头权限模型）
--     连接管理（93036 recon:connection:view）
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (93100, 93020, 93090, '00930100', 'api'::sys_api_node_type, '连接管理-查询', 'GET',    '/api/v1/recon/connections/**', 10, 1, NOW(), NOW()),
    (93101, 93020, 93090, '00930101', 'api'::sys_api_node_type, '连接管理-新建', 'POST',   '/api/v1/recon/connections/**', 11, 1, NOW(), NOW()),
    (93102, 93020, 93090, '00930102', 'api'::sys_api_node_type, '连接管理-更新', 'PUT',    '/api/v1/recon/connections/**', 12, 1, NOW(), NOW()),
    (93103, 93020, 93090, '00930103', 'api'::sys_api_node_type, '连接管理-删除', 'DELETE', '/api/v1/recon/connections/**', 13, 1, NOW(), NOW()),
    -- 数据源管理（93037 recon:datasource:view，含数据源相关 ops）
    (93104, 93020, 93090, '00930104', 'api'::sys_api_node_type, '数据源管理-查询', 'GET',    '/api/v1/recon/datasources/**',           14, 1, NOW(), NOW()),
    (93105, 93020, 93090, '00930105', 'api'::sys_api_node_type, '数据源管理-新建', 'POST',   '/api/v1/recon/datasources/**',           15, 1, NOW(), NOW()),
    (93106, 93020, 93090, '00930106', 'api'::sys_api_node_type, '数据源管理-更新', 'PUT',    '/api/v1/recon/datasources/**',           16, 1, NOW(), NOW()),
    (93107, 93020, 93090, '00930107', 'api'::sys_api_node_type, '数据源管理-删除', 'DELETE', '/api/v1/recon/datasources/**',           17, 1, NOW(), NOW()),
    (93108, 93020, 93090, '00930108', 'api'::sys_api_node_type, '数据源-手动拉取', 'POST',   '/api/v1/recon/ops/pull/**',              18, 1, NOW(), NOW()),
    (93109, 93020, 93090, '00930109', 'api'::sys_api_node_type, '数据源-试拉',    'POST',   '/api/v1/recon/ops/probe/**',             19, 1, NOW(), NOW()),
    (93110, 93020, 93090, '00930110', 'api'::sys_api_node_type, '数据源-SQL检测',  'POST',   '/api/v1/recon/ops/sql-test',             20, 1, NOW(), NOW()),
    (93111, 93020, 93090, '00930111', 'api'::sys_api_node_type, '数据源-重建',    'POST',   '/api/v1/recon/ops/datasource/**',        21, 1, NOW(), NOW()),
    (93112, 93020, 93090, '00930112', 'api'::sys_api_node_type, '数据源-单条重拉', 'POST',   '/api/v1/recon/ops/fetch-one/**',         22, 1, NOW(), NOW()),
    -- 场景与检查（93038 recon:scenario:view，含 checks 与手动对账 ops）
    (93113, 93020, 93090, '00930113', 'api'::sys_api_node_type, '场景-查询',      'GET',    '/api/v1/recon/scenarios/**',             23, 1, NOW(), NOW()),
    (93114, 93020, 93090, '00930114', 'api'::sys_api_node_type, '场景-新建',      'POST',   '/api/v1/recon/scenarios/**',             24, 1, NOW(), NOW()),
    (93115, 93020, 93090, '00930115', 'api'::sys_api_node_type, '场景-更新',      'PUT',    '/api/v1/recon/scenarios/**',             25, 1, NOW(), NOW()),
    (93116, 93020, 93090, '00930116', 'api'::sys_api_node_type, '场景-删除',      'DELETE', '/api/v1/recon/scenarios/**',             26, 1, NOW(), NOW()),
    (93117, 93020, 93090, '00930117', 'api'::sys_api_node_type, '检查-查询',      'GET',    '/api/v1/recon/checks/**',                27, 1, NOW(), NOW()),
    (93118, 93020, 93090, '00930118', 'api'::sys_api_node_type, '检查-新建',      'POST',   '/api/v1/recon/checks/**',                28, 1, NOW(), NOW()),
    (93119, 93020, 93090, '00930119', 'api'::sys_api_node_type, '检查-更新',      'PUT',    '/api/v1/recon/checks/**',                29, 1, NOW(), NOW()),
    (93120, 93020, 93090, '00930120', 'api'::sys_api_node_type, '检查-删除',      'DELETE', '/api/v1/recon/checks/**',                30, 1, NOW(), NOW()),
    (93121, 93020, 93090, '00930121', 'api'::sys_api_node_type, '场景-手动对账',  'POST',   '/api/v1/recon/ops/recon/**',             31, 1, NOW(), NOW())
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
--    通配挂目录 93035（permission=NULL → authOnly）；细分规则挂对应 view 菜单。
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    -- authOnly 通配 → 目录 93035
    (93091, 93035, 93091, 1, NOW()),
    (93092, 93035, 93092, 2, NOW()),
    (93093, 93035, 93093, 3, NOW()),
    (93094, 93035, 93094, 4, NOW()),
    -- 连接管理（93036）
    (93100, 93036, 93100, 1, NOW()), (93101, 93036, 93101, 2, NOW()),
    (93102, 93036, 93102, 3, NOW()), (93103, 93036, 93103, 4, NOW()),
    -- 数据源管理（93037）
    (93104, 93037, 93104, 1, NOW()), (93105, 93037, 93105, 2, NOW()),
    (93106, 93037, 93106, 3, NOW()), (93107, 93037, 93107, 4, NOW()),
    (93108, 93037, 93108, 5, NOW()), (93109, 93037, 93109, 6, NOW()),
    (93110, 93037, 93110, 7, NOW()), (93111, 93037, 93111, 8, NOW()),
    (93112, 93037, 93112, 9, NOW()),
    -- 场景与检查（93038）
    (93113, 93038, 93113, 1, NOW()), (93114, 93038, 93114, 2, NOW()),
    (93115, 93038, 93115, 3, NOW()), (93116, 93038, 93116, 4, NOW()),
    (93117, 93038, 93117, 5, NOW()), (93118, 93038, 93118, 6, NOW()),
    (93119, 93038, 93119, 7, NOW()), (93120, 93038, 93120, 8, NOW()),
    (93121, 93038, 93121, 9, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE menu_id = v.menu_id AND api_id = v.api_id)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = v.menu_id)
  AND EXISTS (SELECT 1 FROM sys_api  WHERE id = v.api_id);

-- ---------------------------------------------------------------------------
-- 5. 修复历史错位绑定：集成库曾把 recon 通配 api 挂到 iqd 菜单 93030，改挂 93035
-- ---------------------------------------------------------------------------
UPDATE sys_menu_api
SET menu_id = 93035
WHERE api_id BETWEEN 93090 AND 93094
  AND menu_id = 93030;

-- ---------------------------------------------------------------------------
-- 6. 授权给内置租户管理员 role_id=1（页面 view 码 + 按钮码；V20 同款批量写法）
--    ⚠️ 其它角色请按需在管理端分配 recon:* 码；不要给普通角色勾选 write/delete 等高危码。
-- ---------------------------------------------------------------------------
INSERT INTO sys_role_permission (id, role_id, perm_type, target_id, created_at)
SELECT m.id, 1, 'menu'::sys_perm_type, m.id, NOW()
FROM sys_menu m
WHERE m.id BETWEEN 93036 AND 93054
  AND m.app_id = 4
  AND m.status = 1
  AND NOT EXISTS (
    SELECT 1 FROM sys_role_permission rp
    WHERE rp.role_id = 1 AND rp.perm_type = 'menu' AND rp.target_id = m.id
  )
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 迁移后自检（flyway migrate 后手工跑一遍）
--   -- 1) 配置类规则应带 view 码、通配规则 permission 为空（authOnly）
--   SELECT a.http_method, a.path_pattern, m.permission
--   FROM sys_api a
--   JOIN sys_menu_api ma ON ma.api_id = a.id
--   JOIN sys_menu m      ON ma.menu_id = m.id
--   WHERE a.module_id = 93020 AND a.type = 'api' AND a.status = 1
--   ORDER BY a.sort;
--   -- 期望：connections/datasources/scenarios/checks/ops 规则带 recon:*:view；
--   --       4 条 /api/v1/recon/** 通配 permission 为 NULL（authOnly=true）
--   -- 2) 内置管理员应持有 93036-93054 全部码：
--   SELECT target_id, (SELECT permission FROM sys_menu WHERE id = rp.target_id) AS perm
--   FROM sys_role_permission rp WHERE role_id = 1 AND target_id BETWEEN 93036 AND 93054
--   ORDER BY target_id;
-- ===========================================================================
