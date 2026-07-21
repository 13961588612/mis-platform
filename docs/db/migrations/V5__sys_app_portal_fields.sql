-- sys_app 门户字段：kind / runtime / description / portal_group
ALTER TABLE sys_app
    ADD COLUMN IF NOT EXISTS kind VARCHAR(32) NOT NULL DEFAULT 'subsystem',
    ADD COLUMN IF NOT EXISTS runtime VARCHAR(32) NOT NULL DEFAULT 'host',
    ADD COLUMN IF NOT EXISTS description VARCHAR(256),
    ADD COLUMN IF NOT EXISTS portal_group VARCHAR(64);

UPDATE sys_app
SET kind = 'subsystem',
    runtime = 'host',
    description = '用户、组织、角色与菜单的统一底座',
    portal_group = 'governance',
    icon = COALESCE(icon, 'Settings')
WHERE code = 'system';

INSERT INTO sys_app (id, tenant_id, code, name, icon, base_path, mfe_remote, sort, status,
                     kind, runtime, description, portal_group, created_at, updated_at)
VALUES
(2, 1, 'iam', '统一身份 IAM', 'Shield', '/iam', NULL, 2, 1,
 'subsystem', 'host', '账号目录、应用授权与单点登录', 'governance', NOW(), NOW()),
(3, 1, 'ops', '运营中心', 'LayoutDashboard', '/ops', NULL, 3, 1,
 'subsystem', 'host', '运营看板与活动配置', 'operations', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO sys_api (id, tenant_id, app_id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
VALUES
(9006, 1, 1, 4, 9000, '00090006', 'api', '应用列表', 'GET', '/api/v1/apps', 6, 1, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT 75, 90, 9006, 5, NOW()
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = 75);
