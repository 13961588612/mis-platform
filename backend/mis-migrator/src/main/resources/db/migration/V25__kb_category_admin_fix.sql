-- ===========================================================================
-- V25__kb_category_admin_fix.sql —— 修正 V24 与 V18(kb_synonym) 的 ID 冲突（补齐段）
--
-- 背景（重要）：
--   V24__kb_category_admin.sql 选用的 ID 段与 V18__kb_synonym.sql 冲突：
--     * sys_menu 91052 已被 V18 占用（「同义词」页面, kb:config:synonym:view），
--       V24 想插入的「设置分类管理员」按钮(kb:category:manage)被 WHERE NOT EXISTS 守卫静默跳过；
--     * sys_api 91070/91071/91072 已被 V18 占用（同义词-导入预检/提交/下载未导入行），
--       V24 想登记的分类管理员 admins 系列 API 被守卫静默跳过；
--     * 若照 V24 原文执行 C.3，sys_menu_api 91080-91083 会把同义词 API / move API
--       错误挂到同义词页面菜单 91052（权限放大），必须回避。
--   本文件用【全库实测空闲】的 ID 段补齐 V24 的意图，且不与 V18/V24 冲突：
--     * sys_menu 91055        （设置分类管理员按钮，permission=kb:category:manage）
--     * sys_api 91075/91076/91077（admins 列表/新增/移除）
--     * sys_menu_api 91085-91088（91085-91087 → admins 系列；91088 → move(91073)）
--     * sys_role_permission role_id=1 → 91055（口径与 V14/V17/V24 一致）
--
-- 防呆说明：
--   * 91078 (PUT /api/v1/kb/categories/{id}/move)【不插入】——91073 已登记同
--     method+path（V24 C.2 已落库），uk_api_method_path 部分唯一索引会拒绝重复；
--     本文件用 sys_menu_api 91088 把 91073 挂到按钮 91055，语义与 V24 原意图
--     （91073 → 按钮 91052）一致。
--   * 91074（GET manageable-ids）已由 V24 落库并挂页面菜单 91032（91084），
--     本文件不重复处理。
--
-- 幂等性：全部 IF NOT EXISTS / WHERE NOT EXISTS / ON CONFLICT DO NOTHING，可重复执行；
--   在“干净环境”（V24 已执行且无 V18 冲突）下，path/pair 守卫同样保证不撞唯一索引。
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A. sys_menu 91055：设置分类管理员按钮（type=3，挂页面 91032 分类管理）
--    code 取 kb_category_manage；app 91010 / tenant 1；sort 4（对齐 V24 原值）。
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (91055, 1, 91010, 91032, 'kb_category_manage', '设置分类管理员', 3, NULL, NULL, 'kb:category:manage', NULL, 4, 1, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu WHERE app_id = v.app_id AND code = v.code);

-- ---------------------------------------------------------------------------
-- B. sys_api 91075/91076/91077：分类管理员 admins 系列（模块 91020 知识库，挂 catalog 91060）
--    code 段 0096-0098 已实测空闲（uk_api_module_code 不冲突）；
--    path 守卫防与任何历史迁移重复登记（uk_api_method_path）。
-- ---------------------------------------------------------------------------
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (91075, 91020, 91060, '0096', 'api'::sys_api_node_type, '分类管理员列表', 'GET',    '/api/v1/kb/categories/{id}/admins', 91, 1, NOW(), NOW()),
    (91076, 91020, 91060, '0097', 'api'::sys_api_node_type, '新增分类管理员', 'POST',   '/api/v1/kb/categories/{id}/admins', 92, 1, NOW(), NOW()),
    (91077, 91020, 91060, '0098', 'api'::sys_api_node_type, '移除分类管理员', 'DELETE', '/api/v1/kb/category-admins/{adminId}', 93, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (
    SELECT 1 FROM sys_api a
    WHERE a.type = 'api' AND a.status = 1
      AND a.http_method = v.http_method AND a.path_pattern = v.path_pattern
  )
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 91060);

-- ---------------------------------------------------------------------------
-- C. sys_menu_api 91085-91088：按钮 91055 挂 admins 系列 + move(91073)
--    91085-91087 → 91075/91076/91077；91088 → 91073（PUT move，V24 已落库，复用）。
--    列 = (id, menu_id, api_id, sort, created_at)，uk_menu_api_pair(menu_id, api_id) 守卫。
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (91085, 91055, 91075, 1, NOW()),
    (91086, 91055, 91076, 1, NOW()),
    (91087, 91055, 91077, 1, NOW()),
    (91088, 91055, 91073, 1, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE menu_id = v.menu_id AND api_id = v.api_id)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = v.menu_id)
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = v.api_id);

-- ---------------------------------------------------------------------------
-- D. sys_role_permission：内置租户管理员 role_id=1 → 按钮 91055
--    口径与 V14/V17/V24 完全一致；id = menu id（91055）。
-- ---------------------------------------------------------------------------
INSERT INTO sys_role_permission (id, role_id, perm_type, target_id, created_at)
SELECT m.id, 1, 'menu'::sys_perm_type, m.id, NOW()
FROM sys_menu m
WHERE m.id = 91055
  AND m.status = 1
  AND NOT EXISTS (
    SELECT 1 FROM sys_role_permission rp
    WHERE rp.role_id = 1 AND rp.perm_type = 'menu' AND rp.target_id = m.id
  )
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 迁移后自检（在你方环境执行后手工跑一遍）
--
--   -- 1) 按钮节点存在，permission 唯一
--   SELECT id, name, type, permission FROM sys_menu
--   WHERE app_id = 91010 AND permission IN ('kb:category:manage','kb:category:list') AND status = 1
--   ORDER BY id;
--   -- 期望：91032 | 分类管理 | 2 | kb:category:list；91055 | 设置分类管理员 | 3 | kb:category:manage
--
--   -- 2) 注册表：admins 系列 + move + manageable-ids，permission 映射正确
--   SELECT a.id, a.http_method, a.path_pattern, m.id AS menu_id, m.permission
--   FROM sys_api a
--   JOIN sys_menu_api ma ON ma.api_id = a.id
--   JOIN sys_menu m      ON ma.menu_id = m.id
--   WHERE a.id IN (91073, 91074, 91075, 91076, 91077);
--   -- 期望：
--   --   91075 GET    /api/v1/kb/categories/{id}/admins     | 91055 kb:category:manage
--   --   91076 POST   /api/v1/kb/categories/{id}/admins     | 91055 kb:category:manage
--   --   91077 DELETE /api/v1/kb/category-admins/{adminId}  | 91055 kb:category:manage
--   --   91073 PUT    /api/v1/kb/categories/{id}/move       | 91055 kb:category:manage
--   --   91074 GET    /api/v1/kb/categories/manageable-ids  | 91032 kb:category:list
--
--   -- 3) 授权存在
--   SELECT * FROM sys_role_permission WHERE role_id = 1 AND target_id = 91055;
-- ---------------------------------------------------------------------------
