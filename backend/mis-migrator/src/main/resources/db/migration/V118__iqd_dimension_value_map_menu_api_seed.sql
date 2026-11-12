-- ===========================================================================
-- V118__iqd_dimension_value_map_menu_api_seed.sql —— 维度值映射菜单 + API 登记
-- PostgreSQL 16 | 库名: mis_platform
-- 前置：V77（IQD 独立门户 app_id=92010）；V73（iqd:dimension:view/save 菜单 92517/92518）；
--       V117（iqd_dimension_value_map 表）。
--
-- 背景：MIS 部门/门店编号 ≠ 数仓部门/门店编码，需按连接维护对照映射。映射维护页
--   放问数 APP（/iqd/mapping），并暴露 4 个管理面端点。权限复用 iqd:dimension:view|save。
--
-- 段位（已核实 V1-V117）：
--   sys_menu 92528（92525-92527 被 V98 占用）→ 空闲。
--   sys_api 92948-92951（92946/92947 被 V112 占用）→ 空闲；code 00960108-00960111。
--   sys_menu_api 92968-92971（92966/92967 被 V112 占用）→ 空闲。
--
-- 硬规则：每个 /api/v1/iqd/** 端点必须**同时**写 sys_api + sys_menu_api，否则
--   BFF 在 deny-unmapped=true 下直接 40300「接口未授权映射」。
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. sys_menu —— 维度值映射页（type=1，visible=1，挂 92500 目录之下）
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (92528, 1, 92010, 92500, 'iqd-mapping-page', 'IQD 维度值映射', 1, '/iqd/mapping', 'agent/iqd/iqd-mapping-page', NULL, 'Crosshair', 8, 1, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu m WHERE m.app_id = 92010 AND m.path = v.path)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = 92500);

-- ---------------------------------------------------------------------------
-- 2. sys_api —— 4 个维度值映射端点（module 92020；code 00960108-00960111）
--    view 类绑 92517(iqd:dimension:view)；save/delete 绑 92518(iqd:dimension:save)
-- ---------------------------------------------------------------------------
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.id, v.module_id, v.parent_id, v.code, v.type, v.name, v.http_method, v.path_pattern, v.sort, v.status, v.created_at, v.updated_at
FROM (
    VALUES
    (92948, 92020, 92550, '00960108', 'api'::sys_api_node_type, '维度值映射列表', 'GET',    '/api/v1/iqd/dimension-value-maps',                  18, 1, NOW(), NOW()),
    (92949, 92020, 92550, '00960109', 'api'::sys_api_node_type, '维度值映射保存', 'POST',   '/api/v1/iqd/dimension-value-maps',                  19, 1, NOW(), NOW()),
    (92950, 92020, 92550, '00960110', 'api'::sys_api_node_type, '维度值映射删除', 'DELETE', '/api/v1/iqd/dimension-value-maps/{id:[0-9]+}',       20, 1, NOW(), NOW()),
    (92951, 92020, 92550, '00960111', 'api'::sys_api_node_type, '维度值解析预览', 'POST',   '/api/v1/iqd/dimension-value-maps/resolve',          21, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api a WHERE a.id = v.id)
  AND NOT EXISTS (
    SELECT 1 FROM sys_api a
    WHERE a.type = 'api' AND a.status = 1
      AND a.http_method = v.http_method
      AND a.path_pattern = v.path_pattern
  )
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 92550);

-- ---------------------------------------------------------------------------
-- 3. sys_menu_api —— 接口 ⇄ 菜单 绑定（permission 由菜单侧提供）
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (92968, 92517, 92948, 1, NOW()),   -- GET    list    -> iqd:dimension:view
    (92969, 92518, 92949, 1, NOW()),   -- POST   save    -> iqd:dimension:save
    (92970, 92518, 92950, 1, NOW()),   -- DELETE remove  -> iqd:dimension:save
    (92971, 92517, 92951, 1, NOW())    -- POST   resolve -> iqd:dimension:view (预览)
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (
    SELECT 1 FROM sys_menu_api ma WHERE ma.menu_id = v.menu_id AND ma.api_id = v.api_id
  )
  AND EXISTS (SELECT 1 FROM sys_menu m WHERE m.id = v.menu_id AND m.status = 1)
  AND EXISTS (SELECT 1 FROM sys_api a WHERE a.id = v.api_id);

-- ---------------------------------------------------------------------------
-- 4. sys_role_permission —— 授权内置租户管理员（role_id=1）页 92528
-- ---------------------------------------------------------------------------
INSERT INTO sys_role_permission (id, role_id, perm_type, target_id, created_at)
SELECT m.id, 1, 'menu'::sys_perm_type, m.id, NOW()
FROM sys_menu m
WHERE m.id = 92528
  AND m.app_id = 92010
  AND m.status = 1
  AND NOT EXISTS (
    SELECT 1 FROM sys_role_permission rp
    WHERE rp.role_id = 1 AND rp.perm_type = 'menu' AND rp.target_id = m.id
  )
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 迁移后自检
--   SELECT a.http_method, a.path_pattern, m.permission
--     FROM sys_api a
--     JOIN sys_menu_api ma ON ma.api_id = a.id
--     JOIN sys_menu m ON m.id = ma.menu_id
--    WHERE a.id BETWEEN 92948 AND 92951 ORDER BY a.sort;
--   期望 4 行：GET/POST list/save -> iqd:dimension:save 的行+view 的行。
-- ---------------------------------------------------------------------------
