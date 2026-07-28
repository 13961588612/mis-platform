-- ===========================================================================
-- V9：补齐系统管理缺失菜单 + 规范化动态路由 path
-- 2026-07-28
--
-- 背景（代码核实）：
--   1) 前端真实路由为 /system/* 与 /monitor/*（router.tsx 用 /system/* 通配，按 pathname 渲染）。
--   2) 侧栏实时菜单来自后端 /menus/router；其 RouterNode.path 直接取 sys_menu.path。
--      joinPath('/', node.path) 对相对路径 'user' 会得到 '/user'，与 /system/user 不匹配 → 跳转 404。
--   3) V2 种子仅建了 用户/组织/部门/角色/菜单/字典/登录日志/操作日志 7 个系统类页 + 仪表盘；
--      V8 补了「接口模块」。但 员工管理/岗位管理/应用管理/系统参数 4 个前端已存在页面从未建菜单 → 侧栏「不全」。
--   4) 既有系统/监控类叶子 path 均为相对路径（user/org/module/login-log…），动态菜单点击跳转错误
--      （仅 dashboard 因 path='dashboard'→'/dashboard' 正确）。
--
-- 本迁移修正：
--   A) 补 员工/岗位/应用/系统参数 4 个菜单页（完整 path）+ 各自按钮权限，并授予租户管理员(role_id=1)。
--   B) 将既有系统/监控类叶子 path 由相对路径规范为完整路由（/system/*、/monitor/*），修复动态菜单跳转。
--   目录节点(200 系统管理 / 300 系统监控)保持相对路径（仅作分组，不参与跳转）。
--   全部幂等：已存在则跳过；已在执行的库上追加也安全。
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A.1 补齐缺失的 4 个菜单页（type=2），挂在「系统管理」(id=200) 下
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
  (281, 1, 1, 200, '00020015', '员工管理', 2, '/system/employee', 'system/employee/index', 'system:employee:list', 'Users',    8,  1, 1, NOW(), NOW()),
  (285, 1, 1, 200, '00020016', '岗位管理', 2, '/system/post',    'system/post/index',    'system:post:list',    'UserCog',  9,  1, 1, NOW(), NOW()),
  (289, 1, 1, 200, '00020017', '应用管理', 2, '/system/app',     'system/app/index',     'system:app:list',     'AppWindow', 10, 1, 1, NOW(), NOW()),
  (293, 1, 1, 200, '00020018', '系统参数', 2, '/system/config',  'system/config/index',  'system:config:list',  'Settings',  11, 1, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE code IN ('00020015','00020016','00020017','00020018'));

-- ---------------------------------------------------------------------------
-- A.2 各页面按钮权限（type=3）
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
  -- 员工管理 (281)
  (282, 1, 1, 281, '000200150001', '新增员工', 3, NULL, NULL, 'system:employee:add',    NULL, 1, 1, 1, NOW(), NOW()),
  (283, 1, 1, 281, '000200150002', '编辑员工', 3, NULL, NULL, 'system:employee:edit',   NULL, 2, 1, 1, NOW(), NOW()),
  (284, 1, 1, 281, '000200150003', '删除员工', 3, NULL, NULL, 'system:employee:delete', NULL, 3, 1, 1, NOW(), NOW()),
  -- 岗位管理 (285)
  (286, 1, 1, 285, '000200160001', '新增岗位', 3, NULL, NULL, 'system:post:add',    NULL, 1, 1, 1, NOW(), NOW()),
  (287, 1, 1, 285, '000200160002', '编辑岗位', 3, NULL, NULL, 'system:post:edit',   NULL, 2, 1, 1, NOW(), NOW()),
  (288, 1, 1, 285, '000200160003', '删除岗位', 3, NULL, NULL, 'system:post:delete', NULL, 3, 1, 1, NOW(), NOW()),
  -- 应用管理 (289)
  (290, 1, 1, 289, '000200170001', '新增应用', 3, NULL, NULL, 'system:app:add',    NULL, 1, 1, 1, NOW(), NOW()),
  (291, 1, 1, 289, '000200170002', '编辑应用', 3, NULL, NULL, 'system:app:edit',   NULL, 2, 1, 1, NOW(), NOW()),
  (292, 1, 1, 289, '000200170003', '删除应用', 3, NULL, NULL, 'system:app:delete', NULL, 3, 1, 1, NOW(), NOW()),
  -- 系统参数 (293)
  (294, 1, 1, 293, '000200180001', '新增参数', 3, NULL, NULL, 'system:config:add',    NULL, 1, 1, 1, NOW(), NOW()),
  (295, 1, 1, 293, '000200180002', '编辑参数', 3, NULL, NULL, 'system:config:edit',   NULL, 2, 1, 1, NOW(), NOW()),
  (296, 1, 1, 293, '000200180003', '删除参数', 3, NULL, NULL, 'system:config:delete', NULL, 3, 1, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE code IN (
  '000200150001','000200150002','000200150003',
  '000200160001','000200160002','000200160003',
  '000200170001','000200170002','000200170003',
  '000200180001','000200180002','000200180003'
));

-- ---------------------------------------------------------------------------
-- A.3 授予租户管理员(role_id=1) 新增的 4 个菜单页
-- ---------------------------------------------------------------------------
INSERT INTO sys_role_permission (id, role_id, perm_type, target_id, created_at)
SELECT m.id, 1, 'menu'::sys_perm_type, m.id, NOW()
FROM sys_menu m
WHERE m.app_id = 1 AND m.status = 1 AND m.type = 2
  AND m.code IN ('00020015','00020016','00020017','00020018')
  AND NOT EXISTS (
    SELECT 1 FROM sys_role_permission rp
    WHERE rp.role_id = 1 AND rp.perm_type = 'menu' AND rp.target_id = m.id
  )
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- B. 规范化既有系统/监控类叶子 path（相对路径 → 完整路由），修复动态菜单跳转
--    仅处理 type=2 且 path 不以 '/' 开头的叶子；目录节点(200/300)不动。
-- ---------------------------------------------------------------------------
UPDATE sys_menu
SET path = CASE code
    WHEN '0001'     THEN '/dashboard'
    WHEN '00020001' THEN '/system/user'
    WHEN '00020002' THEN '/system/org'
    WHEN '00020006' THEN '/system/dept'
    WHEN '00020003' THEN '/system/role'
    WHEN '00020004' THEN '/system/menu'
    WHEN '00020005' THEN '/system/dict'
    WHEN 'module'   THEN '/system/module'
    WHEN '00030001' THEN '/monitor/login-log'
    WHEN '00030002' THEN '/monitor/oper-log'
    ELSE path
  END,
  updated_at = NOW()
WHERE type = 2
  AND path IS NOT NULL
  AND path NOT LIKE '/%'
  AND code IN ('0001','00020001','00020002','00020006','00020003','00020004','00020005','module','00030001','00030002');
