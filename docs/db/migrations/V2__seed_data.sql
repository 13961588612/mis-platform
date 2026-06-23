-- MIS Platform Phase 1 — 种子数据
-- $2b$10$cIqVItz7UNVFXXZy6abCIOOXulq8qWRZkMfELsfpVJDoek3anNALa

-- ===========================================================================
-- 1. 平台 superadmin
-- ===========================================================================
INSERT INTO sys_platform_user (id, username, password_hash, real_name, status, is_protected, must_change_password, login_fail_count, created_at, updated_at)
VALUES (1, 'superadmin', '$2b$10$cIqVItz7UNVFXXZy6abCIOOXulq8qWRZkMfELsfpVJDoek3anNALa', '平台管理员', 1, 1, 1, 0, NOW(), NOW());

-- ===========================================================================
-- 2. 租户 / APP / 模块
-- ===========================================================================
INSERT INTO sys_tenant (id, code, name, status, created_at, updated_at)
VALUES (1, 'default', '默认租户', 1, NOW(), NOW());

INSERT INTO sys_app (id, tenant_id, code, name, icon, base_path, sort, status, created_at, updated_at)
VALUES (1, 1, 'system', '系统管理', 'Settings', '/system', 1, 1, NOW(), NOW());

INSERT INTO sys_module (id, code, name, service_name, sort, status, created_at, updated_at) VALUES
(1, 'user',   '用户模块', 'mis-user',   1, 1, NOW(), NOW()),
(2, 'org',    '组织模块', 'mis-org',    2, 1, NOW(), NOW()),
(3, 'rbac',   '权限模块', 'mis-rbac',   3, 1, NOW(), NOW()),
(4, 'system', '系统模块', 'mis-system', 4, 1, NOW(), NOW()),
(5, 'audit',  '审计模块', 'mis-audit',  5, 1, NOW(), NOW());

-- ===========================================================================
-- 3. 部门类别 + 根部门
-- ===========================================================================
INSERT INTO sys_dept_category (id, tenant_id, code, name, sort, status, created_at, updated_at) VALUES
(1, 1, 'headquarters', '总部',   1, 1, NOW(), NOW()),
(2, 1, 'branch',       '分公司', 2, 1, NOW(), NOW()),
(3, 1, 'department',   '部门',   3, 1, NOW(), NOW());

INSERT INTO sys_dept (id, tenant_id, parent_id, code, name, category_id, ancestors, sort, status, is_root, deleted, created_at, updated_at)
VALUES (1, 1, 0, '0001', '默认租户', 1, '0', 1, 1, 1, 0, NOW(), NOW());

-- ===========================================================================
-- 4. 员工 + 租户 admin 用户 + 内置角色
-- ===========================================================================
INSERT INTO sys_employee (id, tenant_id, dept_id, employee_no, real_name, status, deleted, created_at, updated_at)
VALUES (1, 1, 1, 'E001', '租户管理员', 1, 0, NOW(), NOW());

INSERT INTO sys_user (id, tenant_id, app_id, employee_id, dept_id, username, password_hash, status, login_fail_count,
                      is_tenant_admin, must_change_password, deleted, created_at, updated_at)
VALUES (1, 1, 1, 1, 1, 'admin', '$2b$10$cIqVItz7UNVFXXZy6abCIOOXulq8qWRZkMfELsfpVJDoek3anNALa', 1, 0, 1, 1, 0, NOW(), NOW());

INSERT INTO sys_role (id, tenant_id, app_id, code, name, type, data_scope, status, deleted, created_at, updated_at)
VALUES (1, 1, 1, 'TENANT_ADMIN', '租户管理员', 1, 1, 1, 0, NOW(), NOW());

INSERT INTO sys_user_role (id, user_id, role_id, created_at) VALUES (1, 1, 1, NOW());

-- ===========================================================================
-- 5. 菜单树 (app_id=1, tenant_id=1)
-- type: 1目录 2菜单 3按钮
-- ===========================================================================
INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at) VALUES
-- 仪表盘
(100, 1, 1, 0, '0001', '仪表盘', 2, 'dashboard', 'dashboard/index', 'dashboard:view', 'LayoutDashboard', 1, 1, 1, NOW(), NOW()),
-- 系统管理目录
(200, 1, 1, 0, '0002', '系统管理', 1, 'system', 'Layout', NULL, 'Settings', 2, 1, 1, NOW(), NOW()),
(201, 1, 1, 200, '00020001', '用户管理', 2, 'user', 'system/user/index', 'system:user:list', 'Users', 1, 1, 1, NOW(), NOW()),
(202, 1, 1, 200, '00020002', '部门管理', 2, 'dept', 'system/dept/index', 'system:dept:list', 'Building2', 2, 1, 1, NOW(), NOW()),
(203, 1, 1, 200, '00020003', '角色管理', 2, 'role', 'system/role/index', 'system:role:list', 'Shield', 3, 1, 1, NOW(), NOW()),
(204, 1, 1, 200, '00020004', '菜单管理', 2, 'menu', 'system/menu/index', 'system:menu:list', 'Menu', 4, 1, 1, NOW(), NOW()),
(205, 1, 1, 200, '00020005', '字典管理', 2, 'dict', 'system/dict/index', 'system:dict:list', 'BookOpen', 5, 1, 1, NOW(), NOW()),
-- 用户按钮
(211, 1, 1, 201, '000200010001', '新增用户', 3, NULL, NULL, 'system:user:add', NULL, 1, 1, 1, NOW(), NOW()),
(212, 1, 1, 201, '000200010002', '编辑用户', 3, NULL, NULL, 'system:user:edit', NULL, 2, 1, 1, NOW(), NOW()),
(213, 1, 1, 201, '000200010003', '删除用户', 3, NULL, NULL, 'system:user:delete', NULL, 3, 1, 1, NOW(), NOW()),
(214, 1, 1, 201, '000200010004', '重置密码', 3, NULL, NULL, 'system:user:resetPwd', NULL, 4, 1, 1, NOW(), NOW()),
(215, 1, 1, 201, '000200010005', '分配角色', 3, NULL, NULL, 'system:user:assignRole', NULL, 5, 1, 1, NOW(), NOW()),
-- 部门按钮
(221, 1, 1, 202, '000200020001', '新增部门', 3, NULL, NULL, 'system:dept:add', NULL, 1, 1, 1, NOW(), NOW()),
(222, 1, 1, 202, '000200020002', '编辑部门', 3, NULL, NULL, 'system:dept:edit', NULL, 2, 1, 1, NOW(), NOW()),
(223, 1, 1, 202, '000200020003', '删除部门', 3, NULL, NULL, 'system:dept:delete', NULL, 3, 1, 1, NOW(), NOW()),
-- 角色按钮
(231, 1, 1, 203, '000200030001', '新增角色', 3, NULL, NULL, 'system:role:add', NULL, 1, 1, 1, NOW(), NOW()),
(232, 1, 1, 203, '000200030002', '编辑角色', 3, NULL, NULL, 'system:role:edit', NULL, 2, 1, 1, NOW(), NOW()),
(233, 1, 1, 203, '000200030003', '删除角色', 3, NULL, NULL, 'system:role:delete', NULL, 3, 1, 1, NOW(), NOW()),
(234, 1, 1, 203, '000200030004', '分配权限', 3, NULL, NULL, 'system:role:assignMenu', NULL, 4, 1, 1, NOW(), NOW()),
-- 菜单按钮
(241, 1, 1, 204, '000200040001', '新增菜单', 3, NULL, NULL, 'system:menu:add', NULL, 1, 1, 1, NOW(), NOW()),
(242, 1, 1, 204, '000200040002', '编辑菜单', 3, NULL, NULL, 'system:menu:edit', NULL, 2, 1, 1, NOW(), NOW()),
(243, 1, 1, 204, '000200040003', '删除菜单', 3, NULL, NULL, 'system:menu:delete', NULL, 3, 1, 1, NOW(), NOW()),
-- 字典按钮
(251, 1, 1, 205, '000200050001', '新增字典', 3, NULL, NULL, 'system:dict:add', NULL, 1, 1, 1, NOW(), NOW()),
(252, 1, 1, 205, '000200050002', '编辑字典', 3, NULL, NULL, 'system:dict:edit', NULL, 2, 1, 1, NOW(), NOW()),
(253, 1, 1, 205, '000200050003', '删除字典', 3, NULL, NULL, 'system:dict:delete', NULL, 3, 1, 1, NOW(), NOW()),
-- 系统监控
(300, 1, 1, 0, '0003', '系统监控', 1, 'monitor', 'Layout', NULL, 'Monitor', 3, 1, 1, NOW(), NOW()),
(301, 1, 1, 300, '00030001', '登录日志', 2, 'login-log', 'monitor/login-log/index', 'monitor:loginlog:list', 'LogIn', 1, 1, 1, NOW(), NOW()),
(302, 1, 1, 300, '00030002', '操作日志', 2, 'oper-log', 'monitor/oper-log/index', 'monitor:operlog:list', 'FileText', 2, 1, 1, NOW(), NOW()),
(321, 1, 1, 302, '000300020001', '日志详情', 3, NULL, NULL, 'monitor:operlog:query', NULL, 1, 1, 1, NOW(), NOW()),
-- 个人中心（侧栏隐藏，F4）
(120, 1, 1, 0, '0004', '个人中心', 2, 'profile', 'profile/index', 'system:profile:view', 'User', 9, 0, 1, NOW(), NOW()),
(121, 1, 1, 120, '00040001', '修改密码', 3, NULL, NULL, 'system:profile:changePassword', NULL, 1, 1, 1, NOW(), NOW()),
-- 认证（仅登录 API，侧栏隐藏）
(90, 1, 1, 0, '0099', '认证', 2, NULL, NULL, NULL, NULL, 99, 0, 1, NOW(), NOW());

-- TENANT_ADMIN 绑定全部菜单节点
INSERT INTO sys_role_permission (id, role_id, perm_type, target_id, created_at)
SELECT id, 1, 'menu'::sys_perm_type, id, NOW() FROM sys_menu WHERE app_id = 1 AND status = 1;

-- ===========================================================================
-- 6. API 树 (app_id=1)
-- ===========================================================================
INSERT INTO sys_api (id, tenant_id, app_id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at) VALUES
-- 用户模块 catalog
(1000, 1, 1, 1, 0,    '0001', 'catalog', '用户模块', NULL, NULL, 1, 1, NOW(), NOW()),
(1001, 1, 1, 1, 1000, '00010001', 'catalog', '用户查询', NULL, NULL, 1, 1, NOW(), NOW()),
(1002, 1, 1, 1, 1001, '000100010001', 'api', '用户列表', 'GET',    '/api/v1/users', 1, 1, NOW(), NOW()),
(1003, 1, 1, 1, 1001, '000100010002', 'api', '用户详情', 'GET',    '/api/v1/users/{id}', 2, 1, NOW(), NOW()),
(1004, 1, 1, 1, 1000, '00010002', 'catalog', '用户写入', NULL, NULL, 2, 1, NOW(), NOW()),
(1005, 1, 1, 1, 1004, '000100020001', 'api', '新增用户', 'POST',   '/api/v1/users', 1, 1, NOW(), NOW()),
(1006, 1, 1, 1, 1004, '000100020002', 'api', '编辑用户', 'PUT',    '/api/v1/users/{id}', 2, 1, NOW(), NOW()),
(1007, 1, 1, 1, 1004, '000100020003', 'api', '删除用户', 'DELETE', '/api/v1/users/{id}', 3, 1, NOW(), NOW()),
(1008, 1, 1, 1, 1004, '000100020004', 'api', '用户状态', 'PUT',    '/api/v1/users/{id}/status', 4, 1, NOW(), NOW()),
(1009, 1, 1, 1, 1004, '000100020005', 'api', '重置密码', 'PUT',    '/api/v1/users/{id}/reset-password', 5, 1, NOW(), NOW()),
(1010, 1, 1, 1, 1004, '000100020006', 'api', '分配角色', 'PUT',    '/api/v1/users/{id}/roles', 6, 1, NOW(), NOW()),
-- 部门模块
(2000, 1, 1, 2, 0,    '0002', 'catalog', '部门模块', NULL, NULL, 2, 1, NOW(), NOW()),
(2001, 1, 1, 2, 2000, '00020001', 'catalog', '部门查询', NULL, NULL, 1, 1, NOW(), NOW()),
(2002, 1, 1, 2, 2001, '000200010001', 'api', '部门树', 'GET',    '/api/v1/depts/tree', 1, 1, NOW(), NOW()),
(2003, 1, 1, 2, 2001, '000200010002', 'api', '部门详情', 'GET',    '/api/v1/depts/{id}', 2, 1, NOW(), NOW()),
(2004, 1, 1, 2, 2000, '00020002', 'catalog', '部门写入', NULL, NULL, 2, 1, NOW(), NOW()),
(2005, 1, 1, 2, 2004, '000200020001', 'api', '新增部门', 'POST',   '/api/v1/depts', 1, 1, NOW(), NOW()),
(2006, 1, 1, 2, 2004, '000200020002', 'api', '编辑部门', 'PUT',    '/api/v1/depts/{id}', 2, 1, NOW(), NOW()),
(2007, 1, 1, 2, 2004, '000200020003', 'api', '删除部门', 'DELETE', '/api/v1/depts/{id}', 3, 1, NOW(), NOW()),
-- 角色模块
(3000, 1, 1, 3, 0,    '0003', 'catalog', '角色模块', NULL, NULL, 3, 1, NOW(), NOW()),
(3001, 1, 1, 3, 3000, '00030001', 'catalog', '角色查询', NULL, NULL, 1, 1, NOW(), NOW()),
(3002, 1, 1, 3, 3001, '000300010001', 'api', '角色列表', 'GET',    '/api/v1/roles', 1, 1, NOW(), NOW()),
(3003, 1, 1, 3, 3001, '000300010002', 'api', '角色详情', 'GET',    '/api/v1/roles/{id}', 2, 1, NOW(), NOW()),
(3004, 1, 1, 3, 3000, '00030002', 'catalog', '角色写入', NULL, NULL, 2, 1, NOW(), NOW()),
(3005, 1, 1, 3, 3004, '000300020001', 'api', '新增角色', 'POST',   '/api/v1/roles', 1, 1, NOW(), NOW()),
(3006, 1, 1, 3, 3004, '000300020002', 'api', '编辑角色', 'PUT',    '/api/v1/roles/{id}', 2, 1, NOW(), NOW()),
(3007, 1, 1, 3, 3004, '000300020003', 'api', '删除角色', 'DELETE', '/api/v1/roles/{id}', 3, 1, NOW(), NOW()),
(3008, 1, 1, 3, 3001, '000300010003', 'api', '角色权限查询', 'GET', '/api/v1/roles/{id}/permissions', 3, 1, NOW(), NOW()),
(3009, 1, 1, 3, 3004, '000300020004', 'api', '分配权限', 'PUT',    '/api/v1/roles/{id}/permissions', 4, 1, NOW(), NOW()),
-- 系统模块（菜单/API/字典/仪表盘）
(4000, 1, 1, 4, 0,    '0004', 'catalog', '系统模块', NULL, NULL, 4, 1, NOW(), NOW()),
(4001, 1, 1, 4, 4000, '00040001', 'catalog', '菜单管理', NULL, NULL, 1, 1, NOW(), NOW()),
(4002, 1, 1, 4, 4001, '000400010001', 'api', '菜单树', 'GET',    '/api/v1/menus/tree', 1, 1, NOW(), NOW()),
(4003, 1, 1, 4, 4001, '000400010002', 'api', '菜单详情', 'GET',    '/api/v1/menus/{id}', 2, 1, NOW(), NOW()),
(4004, 1, 1, 4, 4001, '000400010003', 'api', '新增菜单', 'POST',   '/api/v1/menus', 3, 1, NOW(), NOW()),
(4005, 1, 1, 4, 4001, '000400010004', 'api', '编辑菜单', 'PUT',    '/api/v1/menus/{id}', 4, 1, NOW(), NOW()),
(4006, 1, 1, 4, 4001, '000400010005', 'api', '删除菜单', 'DELETE', '/api/v1/menus/{id}', 5, 1, NOW(), NOW()),
(4007, 1, 1, 4, 4001, '000400010006', 'api', '菜单API查询', 'GET', '/api/v1/menus/{menuId}/apis', 6, 1, NOW(), NOW()),
(4008, 1, 1, 4, 4001, '000400010007', 'api', '菜单API绑定', 'PUT', '/api/v1/menus/{menuId}/apis', 7, 1, NOW(), NOW()),
(4010, 1, 1, 4, 4000, '00040002', 'catalog', 'API管理', NULL, NULL, 2, 1, NOW(), NOW()),
(4011, 1, 1, 4, 4010, '000400020001', 'api', 'API树', 'GET',    '/api/v1/apis/tree', 1, 1, NOW(), NOW()),
(4012, 1, 1, 4, 4010, '000400020002', 'api', '新增API', 'POST',   '/api/v1/apis', 2, 1, NOW(), NOW()),
(4013, 1, 1, 4, 4010, '000400020003', 'api', '编辑API', 'PUT',    '/api/v1/apis/{id}', 3, 1, NOW(), NOW()),
(4014, 1, 1, 4, 4010, '000400020004', 'api', '删除API', 'DELETE', '/api/v1/apis/{id}', 4, 1, NOW(), NOW()),
(4020, 1, 1, 4, 4000, '00040003', 'catalog', '字典管理', NULL, NULL, 3, 1, NOW(), NOW()),
(4021, 1, 1, 4, 4020, '000400030001', 'api', '字典类型列表', 'GET',    '/api/v1/dicts/types', 1, 1, NOW(), NOW()),
(4022, 1, 1, 4, 4020, '000400030002', 'api', '字典类型详情', 'GET',    '/api/v1/dicts/types/{id}', 2, 1, NOW(), NOW()),
(4023, 1, 1, 4, 4020, '000400030003', 'api', '新增字典类型', 'POST',   '/api/v1/dicts/types', 3, 1, NOW(), NOW()),
(4024, 1, 1, 4, 4020, '000400030004', 'api', '编辑字典类型', 'PUT',    '/api/v1/dicts/types/{id}', 4, 1, NOW(), NOW()),
(4025, 1, 1, 4, 4020, '000400030005', 'api', '删除字典类型', 'DELETE', '/api/v1/dicts/types/{id}', 5, 1, NOW(), NOW()),
(4026, 1, 1, 4, 4020, '000400030006', 'api', '字典项列表', 'GET',    '/api/v1/dicts/items', 6, 1, NOW(), NOW()),
(4027, 1, 1, 4, 4020, '000400030007', 'api', '新增字典项', 'POST',   '/api/v1/dicts/items', 7, 1, NOW(), NOW()),
(4028, 1, 1, 4, 4020, '000400030008', 'api', '编辑字典项', 'PUT',    '/api/v1/dicts/items/{id}', 8, 1, NOW(), NOW()),
(4029, 1, 1, 4, 4020, '000400030009', 'api', '删除字典项', 'DELETE', '/api/v1/dicts/items/{id}', 9, 1, NOW(), NOW()),
(4030, 1, 1, 4, 4000, '00040004', 'api', '仪表盘统计', 'GET', '/api/v1/dashboard/stats', 4, 1, NOW(), NOW()),
-- 认证（仅登录）
(9000, 1, 1, 4, 0,    '0009', 'catalog', '认证', NULL, NULL, 9, 1, NOW(), NOW()),
(9001, 1, 1, 4, 9000, '00090001', 'api', '当前用户', 'GET',  '/api/v1/auth/me', 1, 1, NOW(), NOW()),
(9002, 1, 1, 4, 9000, '00090002', 'api', '动态路由', 'GET',  '/api/v1/menus/router', 2, 1, NOW(), NOW()),
(9003, 1, 1, 4, 9000, '00090003', 'api', '登出', 'POST', '/api/v1/auth/logout', 3, 1, NOW(), NOW()),
(9004, 1, 1, 4, 9000, '00090004', 'api', '修改密码', 'PUT',  '/api/v1/auth/password', 4, 1, NOW(), NOW()),
-- 审计
(5000, 1, 1, 5, 0,    '0005', 'catalog', '审计模块', NULL, NULL, 5, 1, NOW(), NOW()),
(5001, 1, 1, 5, 5000, '00050001', 'api', '登录日志', 'GET', '/api/v1/login-logs', 1, 1, NOW(), NOW()),
(5002, 1, 1, 5, 5000, '00050002', 'api', '操作日志', 'GET', '/api/v1/oper-logs', 2, 1, NOW(), NOW()),
(5003, 1, 1, 5, 5000, '00050003', 'api', '操作日志详情', 'GET', '/api/v1/oper-logs/{id}', 3, 1, NOW(), NOW());

-- ===========================================================================
-- 7. 菜单 ↔ API 绑定
-- ===========================================================================
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at) VALUES
-- 仪表盘
(1, 100, 4030, 1, NOW()),
-- 用户
(10, 201, 1002, 1, NOW()),
(11, 201, 2002, 2, NOW()),
(12, 211, 1005, 1, NOW()),
(13, 212, 1003, 1, NOW()),
(14, 212, 1006, 2, NOW()),
(15, 212, 1008, 3, NOW()),
(16, 213, 1007, 1, NOW()),
(17, 214, 1009, 1, NOW()),
(18, 215, 1010, 1, NOW()),
(19, 215, 3002, 2, NOW()),
-- 部门
(20, 202, 2002, 1, NOW()),
(21, 221, 2005, 1, NOW()),
(22, 222, 2003, 1, NOW()),
(23, 222, 2006, 2, NOW()),
(24, 223, 2007, 1, NOW()),
-- 角色
(30, 203, 3002, 1, NOW()),
(31, 231, 3005, 1, NOW()),
(32, 232, 3003, 1, NOW()),
(33, 232, 3006, 2, NOW()),
(34, 233, 3007, 1, NOW()),
(35, 234, 3008, 1, NOW()),
(36, 234, 3009, 2, NOW()),
-- 菜单管理
(40, 204, 4002, 1, NOW()),
(41, 241, 4004, 1, NOW()),
(42, 242, 4003, 1, NOW()),
(43, 242, 4005, 2, NOW()),
(44, 242, 4007, 3, NOW()),
(45, 242, 4008, 4, NOW()),
(46, 243, 4006, 1, NOW()),
(47, 204, 4011, 2, NOW()),
-- 字典
(50, 205, 4021, 1, NOW()),
(51, 205, 4026, 2, NOW()),
(52, 251, 4023, 1, NOW()),
(53, 251, 4027, 2, NOW()),
(54, 252, 4022, 1, NOW()),
(55, 252, 4024, 2, NOW()),
(56, 252, 4028, 3, NOW()),
(57, 253, 4025, 1, NOW()),
(58, 253, 4029, 2, NOW()),
-- 监控
(60, 301, 5001, 1, NOW()),
(61, 302, 5002, 1, NOW()),
(62, 321, 5003, 1, NOW()),
-- 认证 / 个人中心
(70, 90,  9001, 1, NOW()),
(71, 90,  9002, 2, NOW()),
(72, 90,  9003, 3, NOW()),
(73, 121, 9004, 1, NOW());

-- ===========================================================================
-- 8. 字典
-- ===========================================================================
INSERT INTO sys_dict_type (id, tenant_id, code, name, status, created_at, updated_at) VALUES
(1, 0, 'sys_user_status',  '用户状态', 1, NOW(), NOW()),
(2, 0, 'sys_dept_status',  '部门状态', 1, NOW(), NOW()),
(3, 0, 'sys_gender',       '性别',     1, NOW(), NOW()),
(4, 0, 'sys_data_scope',   '数据范围', 1, NOW(), NOW()),
(5, 0, 'sys_menu_type',    '菜单类型', 1, NOW(), NOW());

INSERT INTO sys_dict_item (id, type_id, label, value, sort, status, created_at, updated_at) VALUES
(101, 1, '禁用', '0', 1, 1, NOW(), NOW()),
(102, 1, '启用', '1', 2, 1, NOW(), NOW()),
(103, 1, '锁定', '2', 3, 1, NOW(), NOW()),
(201, 2, '禁用', '0', 1, 1, NOW(), NOW()),
(202, 2, '启用', '1', 2, 1, NOW(), NOW()),
(301, 3, '未知', '0', 1, 1, NOW(), NOW()),
(302, 3, '男',   '1', 2, 1, NOW(), NOW()),
(303, 3, '女',   '2', 3, 1, NOW(), NOW()),
(401, 4, '全部数据',     '1', 1, 1, NOW(), NOW()),
(402, 4, '本部门',       '2', 2, 1, NOW(), NOW()),
(403, 4, '本部门及下级', '3', 3, 1, NOW(), NOW()),
(404, 4, '仅本人',       '4', 4, 1, NOW(), NOW()),
(405, 4, '自定义',       '5', 5, 1, NOW(), NOW()),
(501, 5, '目录', '1', 1, 1, NOW(), NOW()),
(502, 5, '菜单', '2', 2, 1, NOW(), NOW()),
(503, 5, '按钮', '3', 3, 1, NOW(), NOW());

-- ===========================================================================
-- 9. 系统参数
-- ===========================================================================
INSERT INTO sys_config (id, config_key, config_value, remark, created_at, updated_at) VALUES
(1,  'security.password.min_length',              '8',       '密码最小长度', NOW(), NOW()),
(2,  'security.login.max_fail',                   '5',       '最大登录失败次数', NOW(), NOW()),
(3,  'security.login.lock_minutes',               '30',      '锁定时长(分钟)', NOW(), NOW()),
(4,  'security.token.access_ttl',                 '7200',    'Access Token TTL(秒)', NOW(), NOW()),
(5,  'security.token.refresh_ttl',                '604800',  'Refresh Token TTL(秒)', NOW(), NOW()),
(6,  'user.default_password',                     'Mis@123456', '新用户默认密码', NOW(), NOW()),
(7,  'security.password.must_change_on_first_login','true',  '首次登录强制改密', NOW(), NOW());
