-- ===========================================================================
-- V73__iqd_w2_menu_api_seed.sql —— 问数 W2 管理面端点 sys_api + 菜单绑定
-- PostgreSQL 16 | 库名: mis_platform
-- 前置：V71（iqd_* 表结构）；V72（iqd 目录 92500 + config/ask 端点 92550-92555）
--
-- 内容（W2 = T-W2-01/T-W2-02a/T-W2-02b）：
--   1. sys_menu 92505-92509：5 个问数管理页（/ai/iqd/*，visible=1）
--   2. sys_menu 92510-92519：10 个权限码按钮（iqd:catalog/scope/acl/mask/dimension/sync）
--   3. sys_api 92560-92575：16 个 /api/v1/iqd/** W2 端点（含路径变量 {id} / {dimensionCode}）
--   4. sys_menu_api 92560-92575：接口 ⇄ 菜单绑定
--   5. sys_role_permission：授权内置租户管理员（role_id=1）
--
-- ⚠️ 段位说明（已核实 V1-V72）：
--   sys_menu 92500-92504 被 V72 占用 → 本文件取 92505-92519（空闲）。
--   sys_api/sys_menu_api 92550-92555 被 V72 占用 → 本文件取 92560-92575（空闲）。
--   sys_api code 0095 段（V72 用 0094 段；0095 空闲）。
--
-- 硬规则（同 V72）：每个 /api/v1/iqd/** 端点必须**同时**写 sys_api + sys_menu_api
-- （BFF 注册表 = sys_api ⋈ sys_menu_api ⋈ sys_menu INNER JOIN；deny-unmapped=true
-- 时只插一个表 → 40300「接口未授权映射」）。
-- 路径变量用 {id:[0-9]+}（对齐 V55/V65 既有约定）；{dimensionCode} 为字符串不约束。
-- 幂等：固定 ID + WHERE NOT EXISTS + (method,path) 去重；append-only。
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. sys_menu —— 5 个问数管理页（type=1，visible=1，挂 92500 目录之下）
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (92505, 1, 92010, 92500, 'iqd-config-page',  'IQD 连接配置',   1, '/ai/iqd/config',  'agent/ai/iqd/iqd-config-page',  NULL, 'Settings',   1, 1, 1, NOW(), NOW()),
    (92506, 1, 92010, 92500, 'iqd-catalog-page', 'IQD 清单',       1, '/ai/iqd/catalog', 'agent/ai/iqd/iqd-catalog-page', NULL, 'Database',   2, 1, 1, NOW(), NOW()),
    (92507, 1, 92010, 92500, 'iqd-scope-page',   'IQD 范围与权限', 1, '/ai/iqd/scope',   'agent/ai/iqd/iqd-scope-page',   NULL, 'ShieldCheck', 3, 1, 1, NOW(), NOW()),
    (92508, 1, 92010, 92500, 'iqd-test-chat-page', 'IQD 测试问数', 1, '/ai/iqd/test-chat', 'agent/ai/iqd/iqd-test-chat-page', NULL, 'Crosshair',  4, 1, 1, NOW(), NOW()),
    (92509, 1, 92010, 92500, 'iqd-enhance-page', 'IQD 脱敏与维度', 1, '/ai/iqd/enhance', 'agent/ai/iqd/iqd-enhance-page', NULL, 'Sparkles',   5, 1, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu m WHERE m.app_id = 92010 AND m.path = v.path)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = 92500);

-- ---------------------------------------------------------------------------
-- 2. sys_menu —— 10 个权限码按钮（type=3；不进侧栏，只承载 permission）
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (92510, 1, 92010, 92500, 'iqd-catalog-view',    '清单查看',          3, NULL, NULL, 'iqd:catalog:view',    NULL, 11, 1, 1, NOW(), NOW()),
    (92511, 1, 92010, 92500, 'iqd-scope-view',      '范围策略查看',      3, NULL, NULL, 'iqd:scope:view',      NULL, 12, 1, 1, NOW(), NOW()),
    (92512, 1, 92010, 92500, 'iqd-scope-save',      '范围策略保存',      3, NULL, NULL, 'iqd:scope:save',      NULL, 13, 1, 1, NOW(), NOW()),
    (92513, 1, 92010, 92500, 'iqd-acl-view',        '表级 ACL 查看',     3, NULL, NULL, 'iqd:acl:view',        NULL, 14, 1, 1, NOW(), NOW()),
    (92514, 1, 92010, 92500, 'iqd-acl-save',        '表级 ACL 保存',     3, NULL, NULL, 'iqd:acl:save',        NULL, 15, 1, 1, NOW(), NOW()),
    (92515, 1, 92010, 92500, 'iqd-mask-view',       '脱敏规则查看',      3, NULL, NULL, 'iqd:mask:view',       NULL, 16, 1, 1, NOW(), NOW()),
    (92516, 1, 92010, 92500, 'iqd-mask-save',       '脱敏规则保存',      3, NULL, NULL, 'iqd:mask:save',       NULL, 17, 1, 1, NOW(), NOW()),
    (92517, 1, 92010, 92500, 'iqd-dimension-view',  '维度注册表查看',    3, NULL, NULL, 'iqd:dimension:view',  NULL, 18, 1, 1, NOW(), NOW()),
    (92518, 1, 92010, 92500, 'iqd-dimension-save',  '维度注册表保存',    3, NULL, NULL, 'iqd:dimension:save',  NULL, 19, 1, 1, NOW(), NOW()),
    (92519, 1, 92010, 92500, 'iqd-scope-sync',      '字典同步触发',      3, NULL, NULL, 'iqd:scope:sync',      NULL, 20, 1, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu m WHERE m.app_id = 92010 AND m.permission = v.permission)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = 92500);

-- ---------------------------------------------------------------------------
-- 3. sys_api —— 16 个 W2 端点（module 92020；code 0095 段；父节点 92550）
-- ---------------------------------------------------------------------------
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (92560, 92020, 92550, '00950001', 'api'::sys_api_node_type, '问数清单查看',            'GET',    '/api/v1/iqd/catalog',                        1, 1, NOW(), NOW()),
    (92561, 92020, 92550, '00950002', 'api'::sys_api_node_type, '问数清单批量保存',        'POST',   '/api/v1/iqd/catalog/batch',                  2, 1, NOW(), NOW()),
    (92562, 92020, 92550, '00950003', 'api'::sys_api_node_type, '问数范围勾选',            'POST',   '/api/v1/iqd/catalog/in-scope',               3, 1, NOW(), NOW()),
    (92563, 92020, 92550, '00950004', 'api'::sys_api_node_type, '范围策略查看',            'GET',    '/api/v1/iqd/scope/policies',                 4, 1, NOW(), NOW()),
    (92564, 92020, 92550, '00950005', 'api'::sys_api_node_type, '范围策略保存',            'POST',   '/api/v1/iqd/scope/policies',                 5, 1, NOW(), NOW()),
    (92565, 92020, 92550, '00950006', 'api'::sys_api_node_type, '表级 ACL 查看',           'GET',    '/api/v1/iqd/acl',                            6, 1, NOW(), NOW()),
    (92566, 92020, 92550, '00950007', 'api'::sys_api_node_type, '表级 ACL 批量保存',       'POST',   '/api/v1/iqd/acl/batch',                      7, 1, NOW(), NOW()),
    (92567, 92020, 92550, '00950008', 'api'::sys_api_node_type, '表级 ACL 删除',           'DELETE', '/api/v1/iqd/acl/{id:[0-9]+}',                 8, 1, NOW(), NOW()),
    (92568, 92020, 92550, '00950009', 'api'::sys_api_node_type, '脱敏规则查看',            'GET',    '/api/v1/iqd/mask/rules',                     9, 1, NOW(), NOW()),
    (92569, 92020, 92550, '00950010', 'api'::sys_api_node_type, '脱敏规则保存',            'POST',   '/api/v1/iqd/mask/rules',                    10, 1, NOW(), NOW()),
    (92570, 92020, 92550, '00950011', 'api'::sys_api_node_type, '脱敏规则删除',            'DELETE', '/api/v1/iqd/mask/rules/{id:[0-9]+}',        11, 1, NOW(), NOW()),
    (92571, 92020, 92550, '00950012', 'api'::sys_api_node_type, '维度注册表查看',          'GET',    '/api/v1/iqd/dimensions',                    12, 1, NOW(), NOW()),
    (92572, 92020, 92550, '00950013', 'api'::sys_api_node_type, '维度注册表保存',          'POST',   '/api/v1/iqd/dimensions',                    13, 1, NOW(), NOW()),
    (92573, 92020, 92550, '00950014', 'api'::sys_api_node_type, '维度注册表删除',          'DELETE', '/api/v1/iqd/dimensions/{id:[0-9]+}',        14, 1, NOW(), NOW()),
    (92574, 92020, 92550, '00950015', 'api'::sys_api_node_type, '字典同步触发',            'POST',   '/api/v1/iqd/scope/sync/{dimensionCode}',     15, 1, NOW(), NOW()),
    (92575, 92020, 92550, '00950016', 'api'::sys_api_node_type, '字典同步状态',            'GET',    '/api/v1/iqd/scope/dict-sync-status',         16, 1, NOW(), NOW())
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
    (92560, 92510, 92560, 1, NOW()),   -- catalog GET      → iqd:catalog:view
    (92561, 92510, 92561, 1, NOW()),   -- catalog batch    → iqd:catalog:view
    (92562, 92512, 92562, 1, NOW()),   -- catalog in-scope → iqd:scope:save
    (92563, 92511, 92563, 1, NOW()),   -- scope GET        → iqd:scope:view
    (92564, 92512, 92564, 1, NOW()),   -- scope POST       → iqd:scope:save
    (92565, 92513, 92565, 1, NOW()),   -- acl GET          → iqd:acl:view
    (92566, 92514, 92566, 1, NOW()),   -- acl batch        → iqd:acl:save
    (92567, 92514, 92567, 1, NOW()),   -- acl delete       → iqd:acl:save
    (92568, 92515, 92568, 1, NOW()),   -- mask GET         → iqd:mask:view
    (92569, 92516, 92569, 1, NOW()),   -- mask POST        → iqd:mask:save
    (92570, 92516, 92570, 1, NOW()),   -- mask delete      → iqd:mask:save
    (92571, 92517, 92571, 1, NOW()),   -- dimension GET    → iqd:dimension:view
    (92572, 92518, 92572, 1, NOW()),   -- dimension POST   → iqd:dimension:save
    (92573, 92518, 92573, 1, NOW()),   -- dimension delete → iqd:dimension:save
    (92574, 92519, 92574, 1, NOW()),   -- sync trigger     → iqd:scope:sync
    (92575, 92511, 92575, 1, NOW())    -- sync status      → iqd:scope:view
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (
    SELECT 1 FROM sys_menu_api ma WHERE ma.menu_id = v.menu_id AND ma.api_id = v.api_id
  )
  AND EXISTS (SELECT 1 FROM sys_menu m WHERE m.id = v.menu_id AND m.status = 1)
  AND EXISTS (SELECT 1 FROM sys_api  a WHERE a.id = v.api_id);

-- ---------------------------------------------------------------------------
-- 5. sys_role_permission —— 授权内置租户管理员（role_id=1）
--    页 92505-92509 + 按钮 92510-92519
-- ---------------------------------------------------------------------------
INSERT INTO sys_role_permission (id, role_id, perm_type, target_id, created_at)
SELECT m.id, 1, 'menu'::sys_perm_type, m.id, NOW()
FROM sys_menu m
WHERE m.id BETWEEN 92505 AND 92519
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
--   -- 1) sys_menu 权限码登记（10 个按钮）
--   SELECT id, code, permission FROM sys_menu WHERE id BETWEEN 92510 AND 92519 ORDER BY id;
--
--   -- 2) sys_api 注册表（16 行，均应带非空 permission）
--   SELECT a.id, a.http_method, a.path_pattern, m.permission
--   FROM sys_api a
--   JOIN sys_menu_api ma ON ma.api_id = a.id
--   JOIN sys_menu m      ON ma.menu_id = m.id
--   WHERE a.module_id = 92020 AND a.type = 'api' AND a.id BETWEEN 92560 AND 92575
--   ORDER BY a.sort;
--
--   -- 3) 授权行（15 条：92505-92519）
--   SELECT COUNT(*) FROM sys_role_permission
--   WHERE role_id = 1 AND perm_type = 'menu' AND target_id BETWEEN 92505 AND 92519;
-- ---------------------------------------------------------------------------
