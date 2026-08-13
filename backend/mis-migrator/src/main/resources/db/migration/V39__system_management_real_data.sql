-- ===========================================================================
-- V39__system_management_real_data.sql —— 系统管理三页真实化（全站 sample 清零）
-- PostgreSQL 16 | 库名: mis_platform
-- 设计：docs/backend/system-real-data-design-2026-08-12.md（施工唯一标准）
-- 前置：V38 为最新；本文件为 V39，Flyway 只追加不修改已发布版本。
--
-- 内容四段：
--   A. 种子数据：sys_post_type（id 1-5）+ sys_post（id 1-9，对齐真实部门 sys_dept.id=1 总部）
--   B. sys_api 登记：catalog 91178/91189 + api 91179-91188/91190-91194
--   C. sys_menu_api 关联：91268-91283（复用 V9 既有菜单/按钮权限码，一码一菜单）
--   D. 补授 V9 按钮（282-284/286-288/290-292/294-296）给租户管理员 role_id=1
--
-- 段位（2026-08-12 代码库 + 集成库精确区间核验）：
--   sys_api      91178 - 91194   —— V37 用到 91177，本文件顺延
--   sys_api.code 00900084-00900097（API 行）+ 00900098/00900099（2 个 catalog 行）
--                                + 00900100（91194 参数详情，QA 回归补登）
--                                —— V35 用到 00900073-00900083（module 4）；module 2 无 0090 前缀
--   sys_menu_api 91268 - 91283   —— V37 用到 91267，本文件顺延
--   sort         3（org 员工与岗位）/ 6（system 系统参数）—— catalog 内无冲突
--
-- 幂等：固定 ID + WHERE NOT EXISTS + ON CONFLICT DO NOTHING；不得修改 V1-V38。
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A.1 种子：岗位类型 sys_post_type（id 1-5）
-- ---------------------------------------------------------------------------
INSERT INTO sys_post_type (id, tenant_id, code, name, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (1, 1, 'management', '管理', 1, 1, NOW(), NOW()),
    (2, 1, 'tech',       '技术', 2, 1, NOW(), NOW()),
    (3, 1, 'finance',    '财务', 3, 1, NOW(), NOW()),
    (4, 1, 'admin',      '行政', 4, 1, NOW(), NOW()),
    (5, 1, 'operation',  '运营', 5, 1, NOW(), NOW())
) AS v(id, tenant_id, code, name, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_post_type WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_post_type WHERE tenant_id = v.tenant_id AND code = v.code);

-- ---------------------------------------------------------------------------
-- A.2 种子：岗位 sys_post（id 1-9，全部挂真实部门 sys_dept.id=1「总部」）
--     类型分布 1管理×2 / 2技术×4 / 3财务×3
-- ---------------------------------------------------------------------------
INSERT INTO sys_post (id, tenant_id, dept_id, post_type_id, code, name, sort, status, deleted, created_at, updated_at)
SELECT v.* FROM (VALUES
    (1, 1, 1, 1, 'GM',      '总经理',     1, 1, 0, NOW(), NOW()),
    (2, 1, 1, 2, 'RD-D',    '研发总监',   2, 1, 0, NOW(), NOW()),
    (3, 1, 1, 2, 'ARCH',    '架构师',     3, 1, 0, NOW(), NOW()),
    (4, 1, 1, 2, 'TECH-C',  '技术委员会', 4, 1, 0, NOW(), NOW()),
    (5, 1, 1, 3, 'FIN-M',   '财务经理',   5, 1, 0, NOW(), NOW()),
    (6, 1, 1, 3, 'AUD-C',   '内审委员',   6, 1, 0, NOW(), NOW()),
    (7, 1, 1, 1, 'REG-M',   '大区总',     7, 1, 0, NOW(), NOW()),
    (8, 1, 1, 2, 'RD-M',    '研发部经理', 8, 1, 0, NOW(), NOW()),
    (9, 1, 1, 3, 'FIN-S',   '财务主管',   9, 1, 0, NOW(), NOW())
) AS v(id, tenant_id, dept_id, post_type_id, code, name, sort, status, deleted, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_post WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_post WHERE tenant_id = v.tenant_id AND code = v.code AND deleted = 0)
  AND EXISTS (SELECT 1 FROM sys_dept WHERE id = 1);

-- ---------------------------------------------------------------------------
-- B.1 sys_api catalog：91178 '员工与岗位'（module 2 / parent 1950 组织模块 / sort 3）
--     catalog 同样需要 code（NOT NULL + uk_api_module_code），取 00900098（module 2 无占用）
-- ---------------------------------------------------------------------------
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (91178, 2, 1950, '00900098', 'catalog'::sys_api_node_type, '员工与岗位', NULL, NULL, 3, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api WHERE module_id = v.module_id AND code = v.code)
  AND EXISTS (SELECT 1 FROM sys_module WHERE id = 2)
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 1950);

-- ---------------------------------------------------------------------------
-- B.2 sys_api 叶子：员工/岗位端点（module 2 / parent 91178 / code 00900084-00900093）
--     注：GET /api/v1/employees 已登记于 V4:1011，本文件不重复登记（只补 menu_api 绑定 91268）
-- ---------------------------------------------------------------------------
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (91179, 2, 91178, '00900084', 'api'::sys_api_node_type, '员工详情',     'GET',    '/api/v1/employees/{id:[0-9]+}', 1, 1, NOW(), NOW()),
    (91180, 2, 91178, '00900085', 'api'::sys_api_node_type, '新增员工',     'POST',   '/api/v1/employees',              2, 1, NOW(), NOW()),
    (91181, 2, 91178, '00900086', 'api'::sys_api_node_type, '编辑员工',     'PUT',    '/api/v1/employees/{id:[0-9]+}', 3, 1, NOW(), NOW()),
    (91182, 2, 91178, '00900087', 'api'::sys_api_node_type, '删除员工',     'DELETE', '/api/v1/employees/{id:[0-9]+}', 4, 1, NOW(), NOW()),
    (91183, 2, 91178, '00900088', 'api'::sys_api_node_type, '岗位列表',     'GET',    '/api/v1/posts',                 5, 1, NOW(), NOW()),
    (91184, 2, 91178, '00900089', 'api'::sys_api_node_type, '岗位详情',     'GET',    '/api/v1/posts/{id:[0-9]+}',     6, 1, NOW(), NOW()),
    (91185, 2, 91178, '00900090', 'api'::sys_api_node_type, '新增岗位',     'POST',   '/api/v1/posts',                 7, 1, NOW(), NOW()),
    (91186, 2, 91178, '00900091', 'api'::sys_api_node_type, '编辑岗位',     'PUT',    '/api/v1/posts/{id:[0-9]+}',     8, 1, NOW(), NOW()),
    (91187, 2, 91178, '00900092', 'api'::sys_api_node_type, '删除岗位',     'DELETE', '/api/v1/posts/{id:[0-9]+}',     9, 1, NOW(), NOW()),
    (91188, 2, 91178, '00900093', 'api'::sys_api_node_type, '岗位类型列表', 'GET',    '/api/v1/post-types',           10, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api WHERE module_id = v.module_id AND code = v.code)
  AND NOT EXISTS (
    SELECT 1 FROM sys_api a
    WHERE a.type = 'api' AND a.status = 1
      AND a.http_method = v.http_method AND a.path_pattern = v.path_pattern
  )
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 91178);

-- ---------------------------------------------------------------------------
-- B.3 sys_api catalog：91189 '系统参数'（module 4 / parent 4000 系统模块 / sort 6）
--     catalog code 取 00900099（module 4 无占用）
-- ---------------------------------------------------------------------------
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (91189, 4, 4000, '00900099', 'catalog'::sys_api_node_type, '系统参数', NULL, NULL, 6, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api WHERE module_id = v.module_id AND code = v.code)
  AND EXISTS (SELECT 1 FROM sys_module WHERE id = 4)
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 4000);

-- ---------------------------------------------------------------------------
-- B.4 sys_api 叶子：系统参数端点（module 4 / parent 91189 / code 00900094-00900100）
--     91194 = GET /api/v1/configs/{id}（参数详情），QA 回归发现 BFF 已暴露但 V39 首稿漏登；
--     deny-unmapped=true（fail-closed）未登记即 403，补登挂菜单 293（同参数列表，一码一菜单）。
-- ---------------------------------------------------------------------------
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (91190, 4, 91189, '00900094', 'api'::sys_api_node_type, '参数列表',     'GET',    '/api/v1/configs',              1, 1, NOW(), NOW()),
    (91191, 4, 91189, '00900095', 'api'::sys_api_node_type, '新增参数',     'POST',   '/api/v1/configs',              3, 1, NOW(), NOW()),
    (91192, 4, 91189, '00900096', 'api'::sys_api_node_type, '编辑参数',     'PUT',    '/api/v1/configs/{id:[0-9]+}', 4, 1, NOW(), NOW()),
    (91193, 4, 91189, '00900097', 'api'::sys_api_node_type, '删除参数',     'DELETE', '/api/v1/configs/{id:[0-9]+}', 5, 1, NOW(), NOW()),
    (91194, 4, 91189, '00900100', 'api'::sys_api_node_type, '参数详情',     'GET',    '/api/v1/configs/{id:[0-9]+}', 2, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api WHERE module_id = v.module_id AND code = v.code)
  AND NOT EXISTS (
    SELECT 1 FROM sys_api a
    WHERE a.type = 'api' AND a.status = 1
      AND a.http_method = v.http_method AND a.path_pattern = v.path_pattern
  )
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 91189);

-- ---------------------------------------------------------------------------
-- C. sys_menu_api 关联：接口 → 承载权限码的既有菜单节点（一码一菜单，零新增菜单）
--     员工列表用 V4:1011（GET /api/v1/employees）绑定菜单 281
--     员工详情/新增/编辑/删除 → 281/282/283/284
--     岗位列表/详情/新增/编辑/删除/岗位类型 → 285/285/286/287/288/285
--     参数列表/详情/新增/编辑/删除 → 293/293/294/295/296
--     uk_menu_api_pair(menu_id, api_id) 守卫；V8 已 DROP uk_menu_api_api(api_id)。
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (91268, 281, 1011,  1, NOW()),
    (91269, 281, 91179, 1, NOW()),
    (91270, 282, 91180, 1, NOW()),
    (91271, 283, 91181, 1, NOW()),
    (91272, 284, 91182, 1, NOW()),
    (91273, 285, 91183, 1, NOW()),
    (91274, 285, 91184, 1, NOW()),
    (91275, 286, 91185, 1, NOW()),
    (91276, 287, 91186, 1, NOW()),
    (91277, 288, 91187, 1, NOW()),
    (91278, 285, 91188, 1, NOW()),
    (91279, 293, 91190, 1, NOW()),
    (91280, 294, 91191, 1, NOW()),
    (91281, 295, 91192, 1, NOW()),
    (91282, 296, 91193, 1, NOW()),
    (91283, 293, 91194, 1, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE menu_id = v.menu_id AND api_id = v.api_id)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = v.menu_id)
  AND EXISTS (SELECT 1 FROM sys_api  WHERE id = v.api_id);

-- ---------------------------------------------------------------------------
-- D. 补授 V9 按钮给租户管理员（role_id=1）
--    V9 A.3 仅授权了 type=2 的 4 个菜单页；12 个按钮（282-284/286-288/290-292/294-296）
--    从未授权。V39 按 V10 同款写法补授：parent_id IN (281,285,289,293) AND type=3。
-- ---------------------------------------------------------------------------
INSERT INTO sys_role_permission (id, role_id, perm_type, target_id, created_at)
SELECT m.id, 1, 'menu'::sys_perm_type, m.id, NOW()
FROM sys_menu m
WHERE m.parent_id IN (281, 285, 289, 293)
  AND m.type = 3
  AND m.status = 1
  AND NOT EXISTS (
    SELECT 1 FROM sys_role_permission rp
    WHERE rp.role_id = 1 AND rp.perm_type = 'menu' AND rp.target_id = m.id
  )
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 迁移后自检（在你方环境执行 flyway migrate 后手工跑一遍）
--
--   -- 1) 端点全部登记且权限码正确
--   SELECT a.id, a.http_method, a.path_pattern, m.permission
--   FROM sys_api a
--   JOIN sys_menu_api ma ON ma.api_id = a.id
--   JOIN sys_menu m      ON ma.menu_id = m.id
--   WHERE a.id BETWEEN 91179 AND 91194 AND a.type = 'api'
--   ORDER BY a.id;
--   -- 期望：15 行；permission 分布 =
--   --   system:employee:list ×2 (1011/91179)
--   --   system:employee:add ×1 (91180) / edit ×1 (91181) / delete ×1 (91182)
--   --   system:post:list ×3 (91183/91184/91188)
--   --   system:post:add ×1 (91185) / edit ×1 (91186) / delete ×1 (91187)
--   --   system:config:list ×2 (91190/91194) / add ×1 (91191) / edit ×1 (91192) / delete ×1 (91193)
--
--   -- 2) 一码一菜单回归：每个 api 只挂一个菜单
--   SELECT api_id, count(*) FROM sys_menu_api
--   WHERE api_id IN (1011, 91179, 91180, 91181, 91182, 91183, 91184, 91185, 91186, 91187, 91188, 91190, 91191, 91192, 91193, 91194)
--   GROUP BY api_id HAVING count(*) > 1;
--   -- 期望：0 行
--
--   -- 3) (module_id, code) 无重复
--   SELECT module_id, code, count(*) FROM sys_api
--   WHERE id BETWEEN 91178 AND 91194
--   GROUP BY module_id, code HAVING count(*) > 1;
--   -- 期望：0 行
--
--   -- 4) 种子岗位/岗位类型完整
--   SELECT (SELECT count(*) FROM sys_post_type WHERE id BETWEEN 1 AND 5) AS types,
--          (SELECT count(*) FROM sys_post WHERE id BETWEEN 1 AND 9 AND deleted = 0) AS posts;
--   -- 期望：5 / 9
--
--   -- 5) 按钮补授：12 个按钮全有 role_id=1 授权
--   SELECT count(*) FROM sys_menu
--   WHERE parent_id IN (281,285,289,293) AND type = 3 AND status = 1
--     AND NOT EXISTS (SELECT 1 FROM sys_role_permission rp
--                     WHERE rp.role_id=1 AND rp.perm_type='menu' AND rp.target_id = sys_menu.id);
--   -- 期望：0 行
-- ---------------------------------------------------------------------------
