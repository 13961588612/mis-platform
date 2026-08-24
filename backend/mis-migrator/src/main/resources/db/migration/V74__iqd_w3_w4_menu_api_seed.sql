-- ===========================================================================
-- V74__iqd_w3_w4_menu_api_seed.sql —— 问数 W3/W4 端点 sys_api + 菜单绑定
-- PostgreSQL 16 | 库名: mis_platform
-- 前置：V71（iqd_* 表结构）；V72（iqd 目录 92500 + config/ask 端点 92550-92555）；
--       V73（W2 端点 92560-92575 + 权限码 92505-92519）
--
-- 内容（W3 = T-W3-01 审计回查；W4 = T-W4-01 增强物料）：
--   1. sys_menu 92520：问数审计页（/ai/iqd/traces，visible=1）
--   2. sys_menu 92521-92524：4 个权限码按钮（iqd:enhance:view/save/sync + iqd:test:use）
--   3. sys_api 92576-92585：10 个 /api/v1/iqd/** W3/W4 端点
--   4. sys_menu_api 92576-92585：接口 ⇄ 菜单绑定
--   5. sys_role_permission：授权内置租户管理员（role_id=1）
--
-- ⚠️ 段位说明（已核实 V1-V73）：
--   sys_menu 92500-92519 被 V72/V73 占用 → 本文件取 92520-92524（空闲）。
--   sys_api/sys_menu_api 92550-92575 被 V72/V73 占用 → 本文件取 92576-92585（空闲）。
--   sys_api code 0096 段（V72 用 0094、V73 用 0095；0096 空闲）。
--
-- 硬规则（同 V72/V73）：每个 /api/v1/iqd/** 端点必须**同时**写 sys_api + sys_menu_api
-- （BFF 注册表 = sys_api ⋈ sys_menu_api ⋈ sys_menu INNER JOIN；deny-unmapped=true
-- 时只插一个表 → 40300「接口未授权映射」）。
-- 路径变量用 {id:[0-9]+}（对齐 V55/V65 既有约定）。
-- /internal/v1/iqd/** 不在此登记：Worker 内网直调，无 MIS JWT（同 V72 豁免口径）。
-- 幂等：固定 ID + WHERE NOT EXISTS + (method,path) 去重；append-only。
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. sys_menu —— 问数审计页（type=1，visible=1，挂 92500 目录之下）
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (92520, 1, 92010, 92500, 'iqd-trace-page', 'IQD 问数审计', 1, '/ai/iqd/traces', 'agent/ai/iqd/iqd-trace-page', NULL, 'History', 6, 1, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu m WHERE m.app_id = 92010 AND m.path = v.path)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = 92500);

-- ---------------------------------------------------------------------------
-- 2. sys_menu —— 4 个权限码按钮（type=3；不进侧栏，只承载 permission）
--    iqd:test:use 挂测试问数页 92508 之下；enhance 三个码挂 92500 目录
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (92521, 1, 92010, 92500, 'iqd-enhance-view',  '增强物料查看',  3, NULL, NULL, 'iqd:enhance:view', NULL, 21, 1, 1, NOW(), NOW()),
    (92522, 1, 92010, 92500, 'iqd-enhance-save',  '增强物料保存',  3, NULL, NULL, 'iqd:enhance:save', NULL, 22, 1, 1, NOW(), NOW()),
    (92523, 1, 92010, 92500, 'iqd-enhance-sync',  '增强物料推送',  3, NULL, NULL, 'iqd:enhance:sync', NULL, 23, 1, 1, NOW(), NOW()),
    (92524, 1, 92010, 92508, 'iqd-test-use',      '测试问数使用',  3, NULL, NULL, 'iqd:test:use',     NULL, 24, 1, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu m WHERE m.app_id = 92010 AND m.permission = v.permission)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = 92500);

-- ---------------------------------------------------------------------------
-- 3. sys_api —— 10 个 W3/W4 端点（module 92020；code 0096 段；父节点 92550）
-- ---------------------------------------------------------------------------
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (92576, 92020, 92550, '00960001', 'api'::sys_api_node_type, '问数审计列表',        'GET',    '/api/v1/iqd/traces',                  1, 1, NOW(), NOW()),
    (92577, 92020, 92550, '00960002', 'api'::sys_api_node_type, '问数审计详情',        'GET',    '/api/v1/iqd/traces/{id:[0-9]+}',      2, 1, NOW(), NOW()),
    (92578, 92020, 92550, '00960003', 'api'::sys_api_node_type, '样本对查看',          'GET',    '/api/v1/iqd/sql-pairs',               3, 1, NOW(), NOW()),
    (92579, 92020, 92550, '00960004', 'api'::sys_api_node_type, '样本对保存',          'POST',   '/api/v1/iqd/sql-pairs',               4, 1, NOW(), NOW()),
    (92580, 92020, 92550, '00960005', 'api'::sys_api_node_type, '样本对删除',          'DELETE', '/api/v1/iqd/sql-pairs/{id:[0-9]+}',   5, 1, NOW(), NOW()),
    (92581, 92020, 92550, '00960006', 'api'::sys_api_node_type, '知识/术语查看',       'GET',    '/api/v1/iqd/knowledge',               6, 1, NOW(), NOW()),
    (92582, 92020, 92550, '00960007', 'api'::sys_api_node_type, '知识/术语保存',       'POST',   '/api/v1/iqd/knowledge',               7, 1, NOW(), NOW()),
    (92583, 92020, 92550, '00960008', 'api'::sys_api_node_type, '知识/术语删除',       'DELETE', '/api/v1/iqd/knowledge/{id:[0-9]+}',   8, 1, NOW(), NOW()),
    (92584, 92020, 92550, '00960009', 'api'::sys_api_node_type, 'S-07 术语导入',       'POST',   '/api/v1/iqd/knowledge/import-s07',    9, 1, NOW(), NOW()),
    (92585, 92020, 92550, '00960010', 'api'::sys_api_node_type, '增强物料推送',        'POST',   '/api/v1/iqd/enhance/push',           10, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api a WHERE a.module_id = 92020 AND a.code = v.code)
  AND NOT EXISTS (
    SELECT 1 FROM sys_api a
    WHERE a.type = 'api' AND a.status = 1
      AND a.http_method = v.http_method
      AND a.path_pattern = v.path_pattern
  )
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 92550);

-- ---------------------------------------------------------------------------
-- 4. sys_menu_api —— 接口 ⇄ 菜单 绑定（permission 由菜单侧提供）
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (92576, 92504, 92576, 1, NOW()),   -- traces GET      → iqd:trace:view
    (92577, 92504, 92577, 1, NOW()),   -- traces detail   → iqd:trace:view
    (92578, 92521, 92578, 1, NOW()),   -- sql-pairs GET   → iqd:enhance:view
    (92579, 92522, 92579, 1, NOW()),   -- sql-pairs POST  → iqd:enhance:save
    (92580, 92522, 92580, 1, NOW()),   -- sql-pairs DEL   → iqd:enhance:save
    (92581, 92521, 92581, 1, NOW()),   -- knowledge GET   → iqd:enhance:view
    (92582, 92522, 92582, 1, NOW()),   -- knowledge POST  → iqd:enhance:save
    (92583, 92522, 92583, 1, NOW()),   -- knowledge DEL   → iqd:enhance:save
    (92584, 92522, 92584, 1, NOW()),   -- import-s07      → iqd:enhance:save
    (92585, 92523, 92585, 1, NOW())    -- enhance push    → iqd:enhance:sync
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (
    SELECT 1 FROM sys_menu_api ma WHERE ma.menu_id = v.menu_id AND ma.api_id = v.api_id
  )
  AND EXISTS (SELECT 1 FROM sys_menu m WHERE m.id = v.menu_id AND m.status = 1)
  AND EXISTS (SELECT 1 FROM sys_api  a WHERE a.id = v.api_id);

-- ---------------------------------------------------------------------------
-- 5. sys_role_permission —— 授权内置租户管理员（role_id=1）
--    页 92520 + 按钮 92521-92524
-- ---------------------------------------------------------------------------
INSERT INTO sys_role_permission (id, role_id, perm_type, target_id, created_at)
SELECT m.id, 1, 'menu'::sys_perm_type, m.id, NOW()
FROM sys_menu m
WHERE m.id BETWEEN 92520 AND 92524
  AND m.app_id = 92010
  AND m.status = 1
  AND NOT EXISTS (
    SELECT 1 FROM sys_role_permission rp
    WHERE rp.role_id = 1 AND rp.perm_type = 'menu' AND rp.target_id = m.id
  )
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 迁移后自检
--
--   -- 1) sys_api 注册表（10 行，均应带非空 permission）
--   SELECT a.id, a.http_method, a.path_pattern, m.permission
--   FROM sys_api a
--   JOIN sys_menu_api ma ON ma.api_id = a.id
--   JOIN sys_menu m      ON ma.menu_id = m.id
--   WHERE a.module_id = 92020 AND a.type = 'api' AND a.id BETWEEN 92576 AND 92585
--   ORDER BY a.sort;
--
--   -- 2) 授权行（5 条：92520-92524）
--   SELECT COUNT(*) FROM sys_role_permission
--   WHERE role_id = 1 AND perm_type = 'menu' AND target_id BETWEEN 92520 AND 92524;
-- ---------------------------------------------------------------------------
