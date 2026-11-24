-- ===========================================================================
-- V179__spm_menu_button_perms.sql —— 超市运营取消 authOnly，改为菜单/按钮分码
-- 对齐 V178 imap：view / edit / audit / delete；禁止整包 /api/v1/spm/** authOnly。
-- 段位续用 96xxx：菜单 96030/96037-96040；API 96100-96105；menu_api 同号。
-- ===========================================================================

-- 1. 可见目录 + 闭店退卡菜单页 + 按钮
INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (96030, 1, 96001, 0,     'spm',                 '超市运营', 1, NULL, NULL, NULL,                              'Store', 1, 1, 1, NOW(), NOW()),
    (96037, 1, 96001, 96030, 'spm_cashcard_close',  '闭店退卡', 2, NULL, NULL, 'spm:cashcard:close-cleanup:view',   NULL,  2, 1, 1, NOW(), NOW()),
    (96038, 1, 96001, 96037, 'spm_cashcard_edit',   '新建/编辑', 3, NULL, NULL, 'spm:cashcard:close-cleanup:edit',   NULL,  1, 1, 1, NOW(), NOW()),
    (96039, 1, 96001, 96037, 'spm_cashcard_audit',  '审核',     3, NULL, NULL, 'spm:cashcard:close-cleanup:audit',  NULL,  2, 1, 1, NOW(), NOW()),
    (96040, 1, 96001, 96037, 'spm_cashcard_delete', '删除',     3, NULL, NULL, 'spm:cashcard:close-cleanup:delete', NULL,  3, 1, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu WHERE app_id = 96001 AND code = v.code)
  AND EXISTS (SELECT 1 FROM sys_app WHERE id = 96001);

-- 首页挂到可见目录下（原挂在隐藏 API 目录 96035）
UPDATE sys_menu
   SET parent_id = 96030,
       sort = 1,
       updated_at = NOW()
 WHERE id = 96036
   AND app_id = 96001
   AND EXISTS (SELECT 1 FROM sys_menu WHERE id = 96030);

-- 2. 解除 authOnly 通配绑定（挂 permission=NULL 目录 → 登录即过）
DELETE FROM sys_menu_api
 WHERE id IN (96091, 96092, 96093, 96094)
    OR (menu_id = 96035 AND api_id IN (96091, 96092, 96093, 96094));

-- 停用四条 authOnly 通配 API，避免被其它菜单误挂回
UPDATE sys_api
   SET status = 0,
       name = CASE id
         WHEN 96091 THEN '超市运营查询（已停用 authOnly）'
         WHEN 96092 THEN '超市运营新建（已停用 authOnly）'
         WHEN 96093 THEN '超市运营更新（已停用 authOnly）'
         WHEN 96094 THEN '超市运营删除（已停用 authOnly）'
         ELSE name
       END,
       updated_at = NOW()
 WHERE id IN (96091, 96092, 96093, 96094);

-- 3. 分码 API（更具体 path 优先；audit 先于 POST 通配）
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (96100, 96020, 96090, '00960100', 'api'::sys_api_node_type, '超市运营-健康检查',     'GET',    '/api/v1/spm/health',                              10, 1, NOW(), NOW()),
    (96101, 96020, 96090, '00960101', 'api'::sys_api_node_type, '闭店退卡-查询',         'GET',    '/api/v1/spm/cashcard/**',                        11, 1, NOW(), NOW()),
    (96102, 96020, 96090, '00960102', 'api'::sys_api_node_type, '闭店退卡-审核',         'POST',   '/api/v1/spm/cashcard/shop-close-cleanup/*/audit', 12, 1, NOW(), NOW()),
    (96103, 96020, 96090, '00960103', 'api'::sys_api_node_type, '闭店退卡-新建',         'POST',   '/api/v1/spm/cashcard/**',                        13, 1, NOW(), NOW()),
    (96104, 96020, 96090, '00960104', 'api'::sys_api_node_type, '闭店退卡-更新',         'PUT',    '/api/v1/spm/cashcard/**',                        14, 1, NOW(), NOW()),
    (96105, 96020, 96090, '00960105', 'api'::sys_api_node_type, '闭店退卡-删除',         'DELETE', '/api/v1/spm/cashcard/**',                        15, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api WHERE module_id = 96020 AND code = v.code)
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 96090);

INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (96100, 96036, 96100, 1, NOW()),
    (96101, 96037, 96101, 1, NOW()),
    (96102, 96039, 96102, 1, NOW()),
    (96103, 96038, 96103, 1, NOW()),
    (96104, 96038, 96104, 2, NOW()),
    (96105, 96040, 96105, 1, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE menu_id = v.menu_id AND api_id = v.api_id)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = v.menu_id)
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = v.api_id);

-- 4. 超管角色补授新菜单/按钮（含目录）
INSERT INTO sys_role_permission (id, role_id, perm_type, target_id, created_at)
SELECT m.id, 1, 'menu'::sys_perm_type, m.id, NOW()
FROM sys_menu m
WHERE m.app_id = 96001
  AND m.status = 1
  AND m.id IN (96030, 96036, 96037, 96038, 96039, 96040)
  AND NOT EXISTS (
    SELECT 1 FROM sys_role_permission rp
    WHERE rp.role_id = 1 AND rp.perm_type = 'menu' AND rp.target_id = m.id
  )
ON CONFLICT (id) DO NOTHING;
