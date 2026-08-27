-- ===========================================================================
-- V55__dept_types_menu_api_binding.sql —— 部门类型端点补挂 sys_menu_api（V54 补偿）
-- PostgreSQL 16 | 库名: mis_platform
-- 前置：V54 已建 sys_dept_type / 部门字段，并尝试登记 sys_api 9201-9205。
--
-- 根因：ApiService.registry() = sys_api ⋈ sys_menu_api ⋈ sys_menu；
--   V54 仅写了 sys_api，未写 sys_menu_api → BFF deny-unmapped 下返回
--   40300「接口未授权映射」（如 GET /api/v1/dept-types/tree）。
--
-- 内容：
--   A. 确保 sys_api 9201-9205 存在（若 V54 E 段被守卫跳过则补登）
--   B. 按钮菜单 224-226（system:dept-type:add/edit/delete，挂部门管理 206）
--   C. sys_menu_api 91291-91295（读 → 206；写 → 224/225/226）
--   D. 补授按钮 224-226 给租户管理员 role_id=1
--   E.（顺带）V49 漏挂的 91202/91203 补 menu_api（同根因类问题）
--
-- 段位（2026-08-17 全仓核实）：
--   sys_api      9201-9205（V54）/ 91202-91203（V49，本文件不新建）
--   sys_menu     224-226 —— 206 下 221-223 之后空闲（231 起属角色）
--   sys_menu_api 91291-91297 —— V43 用到 91290；V49 未占 menu_api
--   code         000200060004-000200060006
--
-- 幂等：固定 ID + WHERE NOT EXISTS；不得修改已发布 V1-V54。
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A. 确保 sys_api 9201-9205（与 V54 E 段同口径；已存在则跳过）
-- ---------------------------------------------------------------------------
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (9201, 2, 2001, '00900107', 'api'::sys_api_node_type, '部门类型列表', 'GET',    '/api/v1/dept-types',              3, 1, NOW(), NOW()),
    (9202, 2, 2001, '00900108', 'api'::sys_api_node_type, '部门类型树',   'GET',    '/api/v1/dept-types/tree',         4, 1, NOW(), NOW()),
    (9203, 2, 2004, '00900109', 'api'::sys_api_node_type, '新增部门类型', 'POST',   '/api/v1/dept-types',              4, 1, NOW(), NOW()),
    (9204, 2, 2004, '00900110', 'api'::sys_api_node_type, '编辑部门类型', 'PUT',    '/api/v1/dept-types/{id:[0-9]+}', 5, 1, NOW(), NOW()),
    (9205, 2, 2004, '00900111', 'api'::sys_api_node_type, '删除部门类型', 'DELETE', '/api/v1/dept-types/{id:[0-9]+}', 6, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api WHERE module_id = v.module_id AND code = v.code)
  AND NOT EXISTS (
    SELECT 1 FROM sys_api a
    WHERE a.type = 'api' AND a.status = 1
      AND a.http_method = v.http_method AND a.path_pattern = v.path_pattern
  )
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 2001)
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 2004);

-- 若 V54 已用 path `/api/v1/dept-types/{id}`（无数字约束）写入，统一成 Ant 模板（与岗位类型一致）
UPDATE sys_api
SET path_pattern = '/api/v1/dept-types/{id:[0-9]+}',
    updated_at = NOW()
WHERE id IN (9204, 9205)
  AND path_pattern = '/api/v1/dept-types/{id}';

-- ---------------------------------------------------------------------------
-- B. 按钮菜单（挂 206 部门管理，type=3）
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (224, 1, 1, 206, '000200060004', '新增部门类型', 3, NULL, NULL, 'system:dept-type:add',    NULL, 4, 1, 1, NOW(), NOW()),
    (225, 1, 1, 206, '000200060005', '编辑部门类型', 3, NULL, NULL, 'system:dept-type:edit',   NULL, 5, 1, 1, NOW(), NOW()),
    (226, 1, 1, 206, '000200060006', '删除部门类型', 3, NULL, NULL, 'system:dept-type:delete', NULL, 6, 1, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu WHERE tenant_id = v.tenant_id AND app_id = v.app_id AND code = v.code)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = 206);

-- ---------------------------------------------------------------------------
-- C. sys_menu_api：读挂 206（system:dept:list）；写挂 224/225/226
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (91291, 206, 9201, 1, NOW()),
    (91292, 206, 9202, 1, NOW()),
    (91293, 224, 9203, 1, NOW()),
    (91294, 225, 9204, 1, NOW()),
    (91295, 226, 9205, 1, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE menu_id = v.menu_id AND api_id = v.api_id)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = v.menu_id)
  AND EXISTS (SELECT 1 FROM sys_api  WHERE id = v.api_id);

-- ---------------------------------------------------------------------------
-- D. 补授按钮 224-226 给租户管理员 role_id=1
-- ---------------------------------------------------------------------------
INSERT INTO sys_role_permission (id, role_id, perm_type, target_id, created_at)
SELECT m.id, 1, 'menu'::sys_perm_type, m.id, NOW()
FROM sys_menu m
WHERE m.id IN (224, 225, 226)
  AND m.status = 1
  AND NOT EXISTS (
    SELECT 1 FROM sys_role_permission rp
    WHERE rp.role_id = 1 AND rp.perm_type = 'menu' AND rp.target_id = m.id
  )
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- E. V49 补偿：部门岗位编制 + 岗位类型树 补挂 menu_api（否则同「未授权映射」）
--     91202 → 206 system:dept:list；91203 → 285 岗位管理页（与岗位类型列表同页）
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (91296, 206, 91202, 1, NOW()),
    (91297, 285, 91203, 1, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE menu_id = v.menu_id AND api_id = v.api_id)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = v.menu_id)
  AND EXISTS (SELECT 1 FROM sys_api  WHERE id = v.api_id);

-- ---------------------------------------------------------------------------
-- 迁移后自检
--
--   SELECT a.id, a.http_method, a.path_pattern, m.permission
--   FROM sys_api a
--   JOIN sys_menu_api ma ON ma.api_id = a.id
--   JOIN sys_menu m ON ma.menu_id = m.id
--   WHERE a.id BETWEEN 9201 AND 9205
--   ORDER BY a.id;
--   -- 期望 5 行；permission = system:dept:list ×2 / system:dept-type:add|edit|delete
--
--   SELECT id, permission FROM sys_menu WHERE id IN (224,225,226) ORDER BY id;
-- ---------------------------------------------------------------------------
