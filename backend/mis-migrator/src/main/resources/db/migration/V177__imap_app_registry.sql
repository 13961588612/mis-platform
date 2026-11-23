-- ===========================================================================
-- V177__imap_app_registry.sql —— 室内地图（imap）micro-app + BFF 透传
-- 独立仓 indoor-map；本迁移只写平台 sys_*。业务库仍在 indoor Nest/Prisma。
-- 仅内网：BFF mis.imap.intranet-only。ID 段 97xxx。
-- 权限：view / edit / unlock / delete 分码，禁止整包 authOnly。
-- ===========================================================================

INSERT INTO sys_app (id, tenant_id, code, name, icon, base_path, mfe_remote, sort, status,
                     kind, runtime, description, portal_group, created_at, updated_at)
VALUES (97001, 1, 'imap', '室内地图', 'Map', '/imap', 'http://localhost:5178/', 22, 1,
        'subsystem', 'remote', '室内地图制图（仅内网，micro-app）', 'operations', NOW(), NOW())
ON CONFLICT (id) DO UPDATE
   SET tenant_id    = EXCLUDED.tenant_id,
       code         = EXCLUDED.code,
       name         = EXCLUDED.name,
       icon         = EXCLUDED.icon,
       base_path    = EXCLUDED.base_path,
       mfe_remote   = EXCLUDED.mfe_remote,
       sort         = EXCLUDED.sort,
       status       = EXCLUDED.status,
       kind         = EXCLUDED.kind,
       runtime      = EXCLUDED.runtime,
       description  = EXCLUDED.description,
       portal_group = EXCLUDED.portal_group,
       updated_at   = NOW()
WHERE sys_app.code = 'imap';

INSERT INTO sys_module (id, code, name, service_name, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (97020, 'imap', '室内地图', 'indoor-map-server', 22, 1, NOW(), NOW())
) AS v(id, code, name, service_name, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_module WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_module WHERE code = 'imap')
  AND NOT EXISTS (SELECT 1 FROM sys_module WHERE service_name = 'indoor-map-server');

-- 菜单挂在 imap APP（角色勾选）；登录仍是 SYSTEM 用户，种子把这些菜单授给 role_id=1
INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (97030, 1, 97001, 0,     'imap',      '室内地图', 1, NULL, NULL, NULL,               'Map', 1, 1, 1, NOW(), NOW()),
    (97031, 1, 97001, 97030, 'imap_maps', '地图管理', 2, NULL, NULL, 'imap:map:view',    NULL,  1, 1, 1, NOW(), NOW()),
    (97032, 1, 97001, 97031, 'imap_edit', '编辑画图', 3, NULL, NULL, 'imap:map:edit',    NULL,  1, 1, 1, NOW(), NOW()),
    (97033, 1, 97001, 97031, 'imap_unlk', '强制解锁', 3, NULL, NULL, 'imap:map:unlock',  NULL,  2, 1, 1, NOW(), NOW()),
    (97034, 1, 97001, 97031, 'imap_del',  '删除地图', 3, NULL, NULL, 'imap:map:delete',  NULL,  3, 1, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu WHERE app_id = 97001 AND code = v.code)
  AND EXISTS (SELECT 1 FROM sys_app WHERE id = 97001);

INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (97090, 97020, 0, '0097', 'catalog'::sys_api_node_type, '室内地图 API', NULL::VARCHAR, NULL::VARCHAR, 97, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api WHERE module_id = 97020 AND code = v.code)
  AND EXISTS (SELECT 1 FROM sys_module WHERE id = 97020);

-- 更具体的 path 先登记，供 Registry 优先命中 force-unlock / DELETE
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (97091, 97020, 97090, '00970001', 'api'::sys_api_node_type, '室内地图浏览',     'GET',    '/api/v1/imap/**',                1, 1, NOW(), NOW()),
    (97092, 97020, 97090, '00970002', 'api'::sys_api_node_type, '室内地图强制解锁', 'POST',   '/api/v1/imap/**/force-unlock',   2, 1, NOW(), NOW()),
    (97093, 97020, 97090, '00970003', 'api'::sys_api_node_type, '室内地图删除',     'DELETE', '/api/v1/imap/**',                3, 1, NOW(), NOW()),
    (97094, 97020, 97090, '00970004', 'api'::sys_api_node_type, '室内地图编辑POST', 'POST',   '/api/v1/imap/**',                4, 1, NOW(), NOW()),
    (97095, 97020, 97090, '00970005', 'api'::sys_api_node_type, '室内地图编辑PUT',  'PUT',    '/api/v1/imap/**',                5, 1, NOW(), NOW()),
    (97096, 97020, 97090, '00970006', 'api'::sys_api_node_type, '室内地图编辑PATCH','PATCH',  '/api/v1/imap/**',                6, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api WHERE module_id = 97020 AND code = v.code)
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 97090);

INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (97091, 97031, 97091, 1, NOW()),
    (97092, 97033, 97092, 1, NOW()),
    (97093, 97034, 97093, 1, NOW()),
    (97094, 97032, 97094, 1, NOW()),
    (97095, 97032, 97095, 2, NOW()),
    (97096, 97032, 97096, 3, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE menu_id = v.menu_id AND api_id = v.api_id)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = v.menu_id)
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = v.api_id);

INSERT INTO sys_role_permission (id, role_id, perm_type, target_id, created_at)
SELECT m.id, 1, 'menu'::sys_perm_type, m.id, NOW()
FROM sys_menu m
WHERE m.app_id = 97001
  AND m.status = 1
  AND m.id BETWEEN 97030 AND 97034
  AND NOT EXISTS (
    SELECT 1 FROM sys_role_permission rp
    WHERE rp.role_id = 1 AND rp.perm_type = 'menu' AND rp.target_id = m.id
  )
ON CONFLICT (id) DO NOTHING;
