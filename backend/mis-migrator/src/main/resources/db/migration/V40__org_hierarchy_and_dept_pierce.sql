-- ===========================================================================
-- V40__org_hierarchy_and_dept_pierce.sql —— 组织层级（parent_id）+ 部门穿透锚点（linked_org_id）
-- PostgreSQL 16 | 库名: mis_platform
-- 设计：docs/backend/org-pierce-design-2026-08-13.md（施工唯一标准）
-- 前置：V39 为最新；本文件为 V40，Flyway 只追加不修改已发布版本。
--
-- 内容六段：
--   A. DDL：sys_org.parent_id（NOT NULL DEFAULT 0）+ 索引；sys_dept.linked_org_id（NULL）+ 部分索引
--   B. sys_api 登记：91195-91198（module 2 / code 00900101-00900104）
--   C. 新增按钮菜单：297-299（system:post-type:*，挂 285 岗位管理，type=3）
--   D. sys_menu_api 关联：91284-91287（一码一菜单）
--   E. 补授新按钮 297-299 给租户管理员 role_id=1
--   F. 迁移后自检（见文件尾注释）
--
-- 段位（2026-08-13 全仓核实）：
--   sys_api      91195 - 91198   —— V39 用到 91194，本文件顺延
--   sys_api.code 00900101-00900104 —— V39 用到 00900100（module 2 唯一，不与 V2 0002/0006 前缀冲突）
--   sys_menu_api 91284 - 91287   —— V39 用到 91283，本文件顺延
--   sys_menu     297 - 299       —— V9 用到 296，本文件顺延（挂 285 岗位管理）
--
-- 幂等：固定 ID + WHERE NOT EXISTS + ON CONFLICT DO NOTHING；不得修改 V1-V39。
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A. DDL（幂等）
-- ---------------------------------------------------------------------------
ALTER TABLE sys_org  ADD COLUMN IF NOT EXISTS parent_id BIGINT NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_org_tenant_parent ON sys_org (tenant_id, parent_id);

ALTER TABLE sys_dept ADD COLUMN IF NOT EXISTS linked_org_id BIGINT NULL;
CREATE INDEX IF NOT EXISTS idx_dept_linked_org ON sys_dept (linked_org_id) WHERE deleted = 0;

-- ---------------------------------------------------------------------------
-- B. sys_api 登记（module 2）
--    岗位类型 CRUD 挂 catalog 91178「员工与岗位」（sort 顺延 11/12/13）；
--    组织穿透挂 catalog 2001「部门查询」（sort 3，与部门树/详情同组）。
-- ---------------------------------------------------------------------------
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (91195, 2, 91178, '00900101', 'api'::sys_api_node_type, '新增岗位类型', 'POST',   '/api/v1/post-types',              11, 1, NOW(), NOW()),
    (91196, 2, 91178, '00900102', 'api'::sys_api_node_type, '编辑岗位类型', 'PUT',    '/api/v1/post-types/{id:[0-9]+}', 12, 1, NOW(), NOW()),
    (91197, 2, 91178, '00900103', 'api'::sys_api_node_type, '删除岗位类型', 'DELETE', '/api/v1/post-types/{id:[0-9]+}', 13, 1, NOW(), NOW()),
    (91198, 2, 2001,  '00900104', 'api'::sys_api_node_type, '组织穿透',     'GET',    '/api/v1/depts/pierce',           3,  1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api WHERE module_id = v.module_id AND code = v.code)
  AND NOT EXISTS (
    SELECT 1 FROM sys_api a
    WHERE a.type = 'api' AND a.status = 1
      AND a.http_method = v.http_method AND a.path_pattern = v.path_pattern
  )
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 91178)
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 2001);

-- ---------------------------------------------------------------------------
-- C. 新增按钮菜单（挂 285 岗位管理，type=3，permission system:post-type:*）
--    编码 000200160004-000200160006（V9 000200160001-000200160003 已用于 286-288）
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (297, 1, 1, 285, '000200160004', '新增岗位类型', 3, NULL, NULL, 'system:post-type:add',    NULL, 4, 1, 1, NOW(), NOW()),
    (298, 1, 1, 285, '000200160005', '编辑岗位类型', 3, NULL, NULL, 'system:post-type:edit',   NULL, 5, 1, 1, NOW(), NOW()),
    (299, 1, 1, 285, '000200160006', '删除岗位类型', 3, NULL, NULL, 'system:post-type:delete', NULL, 6, 1, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu WHERE tenant_id = v.tenant_id AND app_id = v.app_id AND code = v.code)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = 285);

-- ---------------------------------------------------------------------------
-- D. sys_menu_api 关联（一码一菜单）
--     岗位类型 CRUD → 297/298/299；组织穿透 → 206（system:dept:list，与部门树同菜单）
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (91284, 297, 91195, 1, NOW()),
    (91285, 298, 91196, 1, NOW()),
    (91286, 299, 91197, 1, NOW()),
    (91287, 206, 91198, 1, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE menu_id = v.menu_id AND api_id = v.api_id)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = v.menu_id)
  AND EXISTS (SELECT 1 FROM sys_api  WHERE id = v.api_id);

-- ---------------------------------------------------------------------------
-- E. 补授新按钮 297-299 给租户管理员（role_id=1，V39 D 段同款写法）
-- ---------------------------------------------------------------------------
INSERT INTO sys_role_permission (id, role_id, perm_type, target_id, created_at)
SELECT m.id, 1, 'menu'::sys_perm_type, m.id, NOW()
FROM sys_menu m
WHERE m.parent_id = 285 AND m.type = 3 AND m.status = 1
  AND m.id IN (297, 298, 299)
  AND NOT EXISTS (
    SELECT 1 FROM sys_role_permission rp
    WHERE rp.role_id = 1 AND rp.perm_type = 'menu' AND rp.target_id = m.id
  )
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 迁移后自检（在你方环境执行 flyway migrate 后手工跑一遍）
--
--   -- 1) 新登记端点全部挂且权限码正确
--   SELECT a.id, a.http_method, a.path_pattern, m.permission
--   FROM sys_api a
--   JOIN sys_menu_api ma ON ma.api_id = a.id
--   JOIN sys_menu m      ON ma.menu_id = m.id
--   WHERE a.id BETWEEN 91195 AND 91198 AND a.type = 'api'
--   ORDER BY a.id;
--   -- 期望：4 行；permission 分布 =
--   --   system:post-type:add ×1 (91195) / edit ×1 (91196) / delete ×1 (91197)
--   --   system:dept:list ×1 (91198，挂菜单 206)
--
--   -- 2) 一码一菜单回归：每个 api 只挂一个菜单
--   SELECT api_id, count(*) FROM sys_menu_api
--   WHERE api_id IN (91195, 91196, 91197, 91198)
--   GROUP BY api_id HAVING count(*) > 1;
--   -- 期望：0 行
--
--   -- 3) (module_id, code) 无重复
--   SELECT module_id, code, count(*) FROM sys_api
--   WHERE id BETWEEN 91195 AND 91198
--   GROUP BY module_id, code HAVING count(*) > 1;
--   -- 期望：0 行
--
--   -- 4) 新按钮 297-299 全部有 role_id=1 授权
--   SELECT count(*) FROM sys_menu
--   WHERE id IN (297, 298, 299)
--     AND NOT EXISTS (SELECT 1 FROM sys_role_permission rp
--                     WHERE rp.role_id=1 AND rp.perm_type='menu' AND rp.target_id = sys_menu.id);
--   -- 期望：0 行
--
--   -- 5) DDL 生效
--   SELECT column_name, is_nullable, column_default FROM information_schema.columns
--   WHERE table_name = 'sys_org'  AND column_name = 'parent_id';
--   -- 期望：parent_id / NO / 0
--   SELECT column_name, is_nullable FROM information_schema.columns
--   WHERE table_name = 'sys_dept' AND column_name = 'linked_org_id';
--   -- 期望：linked_org_id / YES
-- ---------------------------------------------------------------------------
