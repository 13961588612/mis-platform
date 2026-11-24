-- ===========================================================================
-- V174__spm_biz_app_registry.sql —— 超市运营（spm）micro-app + BFF 透传登记
-- 独立仓 mis-spm-biz；本迁移只写平台 sys_*，业务表在 spm 库。
-- 应用仅内网访问：由 BFF mis.spm.intranet-only 控制，不在库里硬编码 IP。
-- ID 段 96xxx，避开 94xxx 财务辅助（V86）。
-- 段位：sys_app 96001 / sys_module 96020 / sys_menu 96035-96036 /
--       sys_api 96090-96094 / sys_menu_api 与 api 同号
-- ===========================================================================

INSERT INTO sys_app (id, tenant_id, code, name, icon, base_path, mfe_remote, sort, status,
                     kind, runtime, description, portal_group, created_at, updated_at)
VALUES (96001, 1, 'spm', '超市运营', 'Store', '/spm', 'http://localhost:5177/', 21, 1,
        'subsystem', 'remote', '超市运营（仅内网，micro-app）', 'operations', NOW(), NOW())
ON CONFLICT (id) DO UPDATE
   SET tenant_id   = EXCLUDED.tenant_id,
       code        = EXCLUDED.code,
       name        = EXCLUDED.name,
       icon        = EXCLUDED.icon,
       base_path   = EXCLUDED.base_path,
       mfe_remote  = EXCLUDED.mfe_remote,
       sort        = EXCLUDED.sort,
       status      = EXCLUDED.status,
       kind        = EXCLUDED.kind,
       runtime     = EXCLUDED.runtime,
       description = EXCLUDED.description,
       portal_group= EXCLUDED.portal_group,
       updated_at  = NOW()
WHERE sys_app.code = 'spm';

INSERT INTO sys_module (id, code, name, service_name, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (96020, 'spm', '超市运营', 'spm-service', 21, 1, NOW(), NOW())
) AS v(id, code, name, service_name, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_module WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_module WHERE code = 'spm')
  AND NOT EXISTS (SELECT 1 FROM sys_module WHERE service_name = 'spm-service');

INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (96035, 1, 96001, 0,     'spm-api',  '超市运营 API', 1, NULL, NULL, NULL,            NULL, 1, 0, 1, NOW(), NOW()),
    (96036, 1, 96001, 96035, 'spm_home', '首页',         2, NULL, NULL, 'spm:home:view', NULL, 1, 1, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu WHERE app_id = 96001 AND code = v.code)
  AND EXISTS (SELECT 1 FROM sys_app WHERE id = 96001);

INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (96090, 96020, 0, '0096', 'catalog'::sys_api_node_type, '超市运营 API', NULL::VARCHAR, NULL::VARCHAR, 96, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api WHERE module_id = 96020 AND code = v.code)
  AND EXISTS (SELECT 1 FROM sys_module WHERE id = 96020);

INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (96091, 96020, 96090, '00960001', 'api'::sys_api_node_type, '超市运营查询（authOnly）', 'GET',    '/api/v1/spm/**', 1, 1, NOW(), NOW()),
    (96092, 96020, 96090, '00960002', 'api'::sys_api_node_type, '超市运营新建（authOnly）', 'POST',   '/api/v1/spm/**', 2, 1, NOW(), NOW()),
    (96093, 96020, 96090, '00960003', 'api'::sys_api_node_type, '超市运营更新（authOnly）', 'PUT',    '/api/v1/spm/**', 3, 1, NOW(), NOW()),
    (96094, 96020, 96090, '00960004', 'api'::sys_api_node_type, '超市运营删除（authOnly）', 'DELETE', '/api/v1/spm/**', 4, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api WHERE module_id = 96020 AND code = v.code)
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 96090);

INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (96091, 96035, 96091, 1, NOW()),
    (96092, 96035, 96092, 2, NOW()),
    (96093, 96035, 96093, 3, NOW()),
    (96094, 96035, 96094, 4, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE menu_id = v.menu_id AND api_id = v.api_id)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = v.menu_id)
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = v.api_id);

INSERT INTO sys_role_permission (id, role_id, perm_type, target_id, created_at)
SELECT m.id, 1, 'menu'::sys_perm_type, m.id, NOW()
FROM sys_menu m
WHERE m.id = 96036
  AND m.app_id = 96001
  AND m.status = 1
  AND NOT EXISTS (
    SELECT 1 FROM sys_role_permission rp
    WHERE rp.role_id = 1 AND rp.perm_type = 'menu' AND rp.target_id = m.id
  )
ON CONFLICT (id) DO NOTHING;
