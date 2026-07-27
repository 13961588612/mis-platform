-- V8：接口模块管理后台重构
-- 1) sys_api 去租户/应用归属，改为归属模块（module_id FK → sys_module）
-- 2) 放开 sys_menu_api 的 UNIQUE(api_id)，仅保留 uk_menu_api_pair(menu_id,api_id)
-- 3) 种子：插入「接口模块」菜单节点 + system:module:* 权限，仅授权给内置角色（sys_role.type=TYPE_BUILTIN=1）
--
-- 说明：
--   * 现有 sys_api.module_id 在 V2/V6 种子中均指向已存在的 sys_module(1..6)，FK 必然成立；
--     本迁移不再新增模块行，故无需补数据。若后续手工写入脏数据导致 FK 失败，需先修复数据。
--   * TYPE_BUILTIN = 1，即 V2 种子中的 role_id = 1（TENANT_ADMIN，type=1）。模块后台仅该角色可见可操作，
--     前端按权限树自动隐藏无权限菜单/按钮。

-- ---------------------------------------------------------------------------
-- 1. sys_api 去租户/应用，归属模块
-- ---------------------------------------------------------------------------
ALTER TABLE sys_api DROP COLUMN tenant_id;
ALTER TABLE sys_api DROP COLUMN app_id;

ALTER TABLE sys_api
    ADD CONSTRAINT fk_api_module FOREIGN KEY (module_id) REFERENCES sys_module (id);

-- 唯一约束由 (app_id, code) 改为 (module_id, code)
ALTER TABLE sys_api DROP CONSTRAINT uk_api_app_code;
ALTER TABLE sys_api
    ADD CONSTRAINT uk_api_module_code UNIQUE (module_id, code);

-- ---------------------------------------------------------------------------
-- 2. sys_menu_api 放开 UNIQUE(api_id)，保留 uk_menu_api_pair
-- ---------------------------------------------------------------------------
ALTER TABLE sys_menu_api DROP CONSTRAINT uk_menu_api_api;

-- ---------------------------------------------------------------------------
-- 3. 种子：接口模块菜单 + 权限，授权给内置角色
-- ---------------------------------------------------------------------------

-- 3.1 菜单页节点（type=2 菜单页，permission=system:module:list），挂在「系统管理」(id=200) 下
INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
VALUES (207, 1, 1, 200, 'module', '接口模块', 2, 'module', 'system/module/index', 'system:module:list', 'Boxes', 7, 1, 1, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- 3.2 按钮节点（type=3），permission 对应 system:module:* 写操作
INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at) VALUES
(271, 1, 1, 207, 'module_add',    '新增模块', 3, NULL, NULL, 'system:module:add',    NULL, 1, 1, 1, NOW(), NOW()),
(272, 1, 1, 207, 'module_edit',   '编辑模块', 3, NULL, NULL, 'system:module:edit',   NULL, 2, 1, 1, NOW(), NOW()),
(273, 1, 1, 207, 'module_delete', '删除模块', 3, NULL, NULL, 'system:module:delete', NULL, 3, 1, 1, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- 3.3 将上述菜单页 + 按钮仅授权给内置角色（role_id=1，type=TYPE_BUILTIN=1）
--     perm_type='menu'，target_id=菜单节点 id
INSERT INTO sys_role_permission (id, role_id, perm_type, target_id, created_at) VALUES
(207, 1, 'menu'::sys_perm_type, 207, NOW()),
(271, 1, 'menu'::sys_perm_type, 271, NOW()),
(272, 1, 'menu'::sys_perm_type, 272, NOW()),
(273, 1, 'menu'::sys_perm_type, 273, NOW())
ON CONFLICT (id) DO NOTHING;
