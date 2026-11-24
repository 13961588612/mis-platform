-- ===========================================================================
-- V180__spm_coupon_close_cleanup_perms.sql —— 超市运营「闭店退券」菜单/按钮分码
-- 段位续用 96xxx：菜单 96041-96044；API 96110-96114；menu_api 同号。
-- ===========================================================================

INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (96041, 1, 96001, 96030, 'spm_coupon_close',  '闭店退券', 2, NULL, NULL, 'spm:coupon:close-cleanup:view',   NULL,  3, 1, 1, NOW(), NOW()),
    (96042, 1, 96001, 96041, 'spm_coupon_edit',   '新建/编辑', 3, NULL, NULL, 'spm:coupon:close-cleanup:edit',   NULL,  1, 1, 1, NOW(), NOW()),
    (96043, 1, 96001, 96041, 'spm_coupon_audit',  '审核',     3, NULL, NULL, 'spm:coupon:close-cleanup:audit',  NULL,  2, 1, 1, NOW(), NOW()),
    (96044, 1, 96001, 96041, 'spm_coupon_delete', '删除',     3, NULL, NULL, 'spm:coupon:close-cleanup:delete', NULL,  3, 1, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu WHERE app_id = 96001 AND code = v.code)
  AND EXISTS (SELECT 1 FROM sys_app WHERE id = 96001)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = 96030);

INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (96110, 96020, 96090, '00961110', 'api'::sys_api_node_type, '闭店退券-查询', 'GET',    '/api/v1/spm/coupon/**',                        20, 1, NOW(), NOW()),
    (96111, 96020, 96090, '00961111', 'api'::sys_api_node_type, '闭店退券-审核', 'POST',   '/api/v1/spm/coupon/shop-close-cleanup/*/audit', 21, 1, NOW(), NOW()),
    (96112, 96020, 96090, '00961112', 'api'::sys_api_node_type, '闭店退券-新建', 'POST',   '/api/v1/spm/coupon/**',                        22, 1, NOW(), NOW()),
    (96113, 96020, 96090, '00961113', 'api'::sys_api_node_type, '闭店退券-更新', 'PUT',    '/api/v1/spm/coupon/**',                        23, 1, NOW(), NOW()),
    (96114, 96020, 96090, '00961114', 'api'::sys_api_node_type, '闭店退券-删除', 'DELETE', '/api/v1/spm/coupon/**',                        24, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api WHERE module_id = 96020 AND code = v.code)
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 96090);

INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (96110, 96041, 96110, 1, NOW()),
    (96111, 96043, 96111, 1, NOW()),
    (96112, 96042, 96112, 1, NOW()),
    (96113, 96042, 96113, 2, NOW()),
    (96114, 96044, 96114, 1, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE menu_id = v.menu_id AND api_id = v.api_id)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = v.menu_id)
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = v.api_id);

INSERT INTO sys_role_permission (id, role_id, perm_type, target_id, created_at)
SELECT m.id, 1, 'menu'::sys_perm_type, m.id, NOW()
FROM sys_menu m
WHERE m.app_id = 96001
  AND m.status = 1
  AND m.id IN (96041, 96042, 96043, 96044)
  AND NOT EXISTS (
    SELECT 1 FROM sys_role_permission rp
    WHERE rp.role_id = 1 AND rp.perm_type = 'menu' AND rp.target_id = m.id
  )
ON CONFLICT (id) DO NOTHING;
