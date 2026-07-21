-- Sprint3：对齐 BFF 实际路径 + 员工列表 / 菜单 permissions / roles.enabled
-- 仅追加；不改已发布 V1–V3

UPDATE sys_api
SET path_pattern = '/api/v1/roles/{id}/menus',
    name = '角色菜单查询',
    updated_at = NOW()
WHERE id = 3008 AND path_pattern = '/api/v1/roles/{id}/permissions';

UPDATE sys_api
SET path_pattern = '/api/v1/roles/{id}/menus',
    name = '分配菜单',
    http_method = 'PUT',
    updated_at = NOW()
WHERE id = 3009 AND path_pattern = '/api/v1/roles/{id}/permissions';

INSERT INTO sys_api (id, tenant_id, app_id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
VALUES
(3010, 1, 1, 3, 3004, '000300020005', 'api', '设置数据范围', 'PUT', '/api/v1/roles/{id}/data-scope', 5, 1, NOW(), NOW()),
(3011, 1, 1, 3, 3001, '000300010004', 'api', '查询数据范围', 'GET',  '/api/v1/roles/{id}/data-scope', 4, 1, NOW(), NOW()),
(3012, 1, 1, 3, 3001, '000300010005', 'api', '启用角色列表', 'GET',  '/api/v1/roles/enabled', 5, 1, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO sys_api (id, tenant_id, app_id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
VALUES
(9005, 1, 1, 4, 9000, '00090005', 'api', '当前权限码', 'GET', '/api/v1/menus/permissions', 5, 1, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO sys_api (id, tenant_id, app_id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
VALUES
(1011, 1, 1, 1, 1001, '000100010003', 'api', '员工列表', 'GET', '/api/v1/employees', 3, 1, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at) VALUES
(37, 234, 3010, 3, NOW()),
(38, 234, 3011, 4, NOW()),
(39, 203, 3012, 2, NOW()),
(74, 90,  9005, 4, NOW()),
(19, 201, 1011, 2, NOW())
ON CONFLICT (id) DO NOTHING;
