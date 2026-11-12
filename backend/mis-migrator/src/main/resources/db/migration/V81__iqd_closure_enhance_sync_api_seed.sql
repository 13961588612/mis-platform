-- ===========================================================================
-- V81__iqd_closure_enhance_sync_api_seed.sql —— 问数闭环补全 + 二期编辑端点 sys_api 登记
-- PostgreSQL 16 | 库名: mis_platform
-- 前置：V74（iqd:enhance:view/save/sync）；V78（iqd:enhance:manage + translate/trial）；
--       V80（编辑态表结构）。
--
-- 问题：BFF 已暴露下列端点，但未写 sys_api + sys_menu_api → deny-unmapped=true
--       返回 40300「接口未授权映射」。
--
-- 内容：
--   1. sys_menu 92526：权限码 iqd:catalog:edit（二期 catalog 编辑）
--   2. sys_api 92588-92592：5 个闭环/编辑端点
--   3. sys_menu_api 92588-92592：接口 ⇄ 菜单绑定
--   4. sys_role_permission：授权内置租户管理员（role_id=1）
--
-- ⚠️ 段位：sys_menu 92525 被 V78 占用 → 本文件取 92526。
--   sys_api/sys_menu_api 92586/92587 被 V78 占用 → 本文件取 92588-92592。
--   sys_api code 0096 段续 00960013-00960017。
-- 硬规则（同 V72-V78）：每个 /api/v1/iqd/** 端点必须同时写 sys_api + sys_menu_api。
-- 幂等：固定 ID + WHERE NOT EXISTS；append-only。
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. sys_menu —— 权限码按钮 iqd:catalog:edit（type=3；挂 92500 目录）
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (92526, 1, 92010, 92500, 'iqd-catalog-edit', '语义模型编辑', 3, NULL, NULL, 'iqd:catalog:edit', NULL, 26, 1, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu m WHERE m.app_id = 92010 AND m.permission = v.permission)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = 92500);

-- ---------------------------------------------------------------------------
-- 2. sys_api —— 5 个闭环补全 / 二期编辑端点（module 92020；code 0096 段）
-- ---------------------------------------------------------------------------
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (92588, 92020, 92550, '00960013', 'api'::sys_api_node_type, '增强同步触发',     'POST', '/api/v1/iqd/enhance/sync',          13, 1, NOW(), NOW()),
    (92589, 92020, 92550, '00960014', 'api'::sys_api_node_type, '增强同步状态',     'GET',  '/api/v1/iqd/enhance/sync-status', 14, 1, NOW(), NOW()),
    (92590, 92020, 92550, '00960015', 'api'::sys_api_node_type, '语义模型节点编辑', 'PUT',  '/api/v1/iqd/catalog/node',          15, 1, NOW(), NOW()),
    (92591, 92020, 92550, '00960016', 'api'::sys_api_node_type, '语义模型同步状态', 'GET',  '/api/v1/iqd/catalog/sync-status', 16, 1, NOW(), NOW()),
    (92592, 92020, 92550, '00960017', 'api'::sys_api_node_type, '语义模型对账',     'POST', '/api/v1/iqd/catalog/reconcile',     17, 1, NOW(), NOW())
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
-- 3. sys_menu_api —— 接口 ⇄ 菜单 绑定（permission 由菜单侧提供）
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (92588, 92523, 92588, 1, NOW()),   -- enhance/sync       → iqd:enhance:sync
    (92589, 92521, 92589, 1, NOW()),   -- enhance/sync-status→ iqd:enhance:view
    (92590, 92526, 92590, 1, NOW()),   -- catalog/node       → iqd:catalog:edit
    (92591, 92526, 92591, 1, NOW()),   -- catalog/sync-status→ iqd:catalog:edit
    (92592, 92526, 92592, 1, NOW())    -- catalog/reconcile  → iqd:catalog:edit
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (
    SELECT 1 FROM sys_menu_api ma WHERE ma.menu_id = v.menu_id AND ma.api_id = v.api_id
  )
  AND EXISTS (SELECT 1 FROM sys_menu m WHERE m.id = v.menu_id AND m.status = 1)
  AND EXISTS (SELECT 1 FROM sys_api  a WHERE a.id = v.api_id);

-- ---------------------------------------------------------------------------
-- 4. sys_role_permission —— 授权内置租户管理员（role_id=1）
-- ---------------------------------------------------------------------------
INSERT INTO sys_role_permission (id, role_id, perm_type, target_id, created_at)
SELECT m.id, 1, 'menu'::sys_perm_type, m.id, NOW()
FROM sys_menu m
WHERE m.id = 92526
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
--   SELECT a.http_method, a.path_pattern, m.permission
--   FROM sys_api a
--   JOIN sys_menu_api ma ON ma.api_id = a.id
--   JOIN sys_menu m      ON ma.menu_id = m.id
--   WHERE a.id BETWEEN 92588 AND 92592
--   ORDER BY a.sort;
-- ---------------------------------------------------------------------------
