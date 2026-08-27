-- ===========================================================================
-- V82__iqd_selfheal_api_seed.sql —— 运维自愈三按钮端点 sys_api 登记 + action 列
-- PostgreSQL 16 | 库名: mis_platform
-- 前置：V81（iqd:catalog:edit + 5 个闭环/编辑端点）；一期 iqd_sync_job 已存在。
--
-- 问题：BFF 已暴露下列 3 个自愈端点，但未写 sys_api + sys_menu_api → deny-unmapped=true
--       返回 40300「接口未授权映射」；且 iqd_sync_job 需新增 action 列以区分自愈动作。
--
-- 内容：
--   1. sys_menu 92527：权限码 iqd:selfheal:exec（type=3；挂 92500 目录）
--   2. sys_api 92593-92595：3 个自愈端点（module 92020；code 0096 段续 00960018-00960020）
--   3. sys_menu_api 92596-92598：接口 ⇄ 菜单绑定
--   4. ALTER TABLE iqd_sync_job ADD COLUMN action VARCHAR(32)（自愈动作审计，可 null）
--   5. sys_role_permission：授权内置租户管理员（role_id=1）
--
-- ⚠️ 段位：sys_menu 92526 被 V81 占用 → 本文件取 92527。
--   sys_api/sys_menu_api 92588-92592 被 V81 占用 → 本文件取 92593-92595（api）/ 92596-92598（menu_api）。
--   sys_api code 0096 段续 00960018-00960020。
-- 硬规则（同 V72-V81）：每个 /api/v1/iqd/** 端点必须同时写 sys_api + sys_menu_api。
-- 幂等：固定 ID + WHERE NOT EXISTS；append-only。
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. sys_menu —— 权限码按钮 iqd:selfheal:exec（type=3；挂 92500 目录）
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (92527, 1, 92010, 92500, 'iqd-selfheal-exec', '运维自愈', 3, NULL, NULL, 'iqd:selfheal:exec', NULL, 27, 1, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu m WHERE m.app_id = 92010 AND m.permission = v.permission)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = 92500);

-- ---------------------------------------------------------------------------
-- 2. sys_api —— 3 个运维自愈端点（module 92020；code 0096 段）
-- ---------------------------------------------------------------------------
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (92593, 92020, 92550, '00960018', 'api'::sys_api_node_type, '运维自愈-强制重建', 'POST', '/api/v1/iqd/self-heal/force-rebuild', 18, 1, NOW(), NOW()),
    (92594, 92020, 92550, '00960019', 'api'::sys_api_node_type, '运维自愈-重新索引', 'POST', '/api/v1/iqd/self-heal/re-index',       19, 1, NOW(), NOW()),
    (92595, 92020, 92550, '00960020', 'api'::sys_api_node_type, '运维自愈-模型校验', 'POST', '/api/v1/iqd/self-heal/validate',       20, 1, NOW(), NOW())
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
    (92596, 92527, 92593, 1, NOW()),   -- self-heal/force-rebuild → iqd:selfheal:exec
    (92597, 92527, 92594, 1, NOW()),   -- self-heal/re-index       → iqd:selfheal:exec
    (92598, 92527, 92595, 1, NOW())    -- self-heal/validate       → iqd:selfheal:exec
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (
    SELECT 1 FROM sys_menu_api ma WHERE ma.menu_id = v.menu_id AND ma.api_id = v.api_id
  )
  AND EXISTS (SELECT 1 FROM sys_menu m WHERE m.id = v.menu_id AND m.status = 1)
  AND EXISTS (SELECT 1 FROM sys_api  a WHERE a.id = v.api_id);

-- ---------------------------------------------------------------------------
-- 4. iqd_sync_job ADD COLUMN action（自愈动作审计；兼容历史 null）
-- ---------------------------------------------------------------------------
ALTER TABLE iqd_sync_job ADD COLUMN IF NOT EXISTS action VARCHAR(32);

-- ---------------------------------------------------------------------------
-- 5. sys_role_permission —— 授权内置租户管理员（role_id=1）
-- ---------------------------------------------------------------------------
INSERT INTO sys_role_permission (id, role_id, perm_type, target_id, created_at)
SELECT m.id, 1, 'menu'::sys_perm_type, m.id, NOW()
FROM sys_menu m
WHERE m.id = 92527
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
--   WHERE a.id BETWEEN 92593 AND 92595
--   ORDER BY a.sort;
--
--   SELECT column_name, data_type
--   FROM information_schema.columns
--   WHERE table_name = 'iqd_sync_job' AND column_name = 'action';
-- ---------------------------------------------------------------------------
