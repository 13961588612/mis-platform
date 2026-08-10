-- ===========================================================================
-- V24__kb_category_admin.sql —— 任意层级节点管理员授权表（kb_category_tree_admin）
--
-- 设计依据：docs/system_design.md §3.1 / §4.1 / §8（知识库域一期）
--          PRD R-KB-P0-2 / R-KB-P0-3 / R-KB-P0-4
--
-- 内容：
--   A. kb_category_admin 表 + 约束 + 索引 + 注释
--      * subject_type 复用 SubjectType(user/role/dept)，CHECK 口径对齐 V15
--      * FK category_id → kb_category ON DELETE CASCADE（删节点级联清授权行，O-1）
--      * created_by 可空（O-2 采纳：授权创建人用户 id，审计/追溯）
--   B. 权限码 kb:category:manage（域级管理码，设置管理员/移动功能门控）
--      * sys_menu 按钮节点 91052（type=3，父页面 91032 分类管理）
--      * sys_role_permission 授权内置租户管理员 role_id=1（口径与 V14/V17 一致）
--   C. API 级登记：sys_api + sys_menu_api，让 ApiPermissionInterceptor 真正拦得住
--      * 91070/91071/91072（admins 列表/新增/移除）、91073（移动）→ 挂按钮 91052（kb:category:manage）
--      * 91074（管辖分类 ID，列表页即需）→ 挂页面菜单 91032（kb:category:list）
--        （与 system_design §4.2「manageable-ids 页面码 kb:category:list」一致；
--          设计 §3.1 DDL 草稿把 91074 挂 91052 属笔误，以 §4.2 端点表为准）
--   D. 迁移后自检 SQL（见文件尾注释）
--
-- 幂等性：全部 IF NOT EXISTS + WHERE NOT EXISTS + ON CONFLICT DO NOTHING，可重复执行。
-- 约束：不修改 V23 及更早版本；ID 段 91052（按钮）/91070-91074（api）/91080-91084（menu_api）
--       均在 KB 91xxx 私有段内，已核对不与 V13/V14/V17 冲突。
--
-- 【sys_api 列清单注意】V8__module_api_refactor.sql 已 DROP sys_api.tenant_id/app_id 列，
--   唯一约束为 uk_api_module_code(module_id, code)；sys_menu_api 列 = (id, menu_id, api_id, sort, created_at)，
--   uk_menu_api_pair(menu_id, api_id) 唯一。照抄 V2/V6 旧模板会直接报列不存在。
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A. kb_category_admin 表
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kb_category_admin (
    id           BIGINT PRIMARY KEY,
    category_id  BIGINT      NOT NULL,
    subject_type VARCHAR(20) NOT NULL,
    subject_id   BIGINT      NOT NULL,
    created_by   BIGINT      NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_kb_category_admin UNIQUE (category_id, subject_type, subject_id),
    CONSTRAINT chk_kb_category_admin_subject CHECK (subject_type IN ('user', 'role', 'dept')),
    CONSTRAINT fk_kb_category_admin_category FOREIGN KEY (category_id)
        REFERENCES kb_category (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_kb_category_admin_subject ON kb_category_admin (subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_kb_category_admin_category ON kb_category_admin (category_id);

COMMENT ON TABLE  kb_category_admin IS '分类节点管理员（管理范围=以该节点为根的子树）';
COMMENT ON COLUMN kb_category_admin.subject_type IS '主体类型 user/role/dept（复用 mis-iam/mis-org 主体 id）';
COMMENT ON COLUMN kb_category_admin.created_by   IS '授权创建人用户 id（O-2，可空）';

-- ---------------------------------------------------------------------------
-- B. 权限码 kb:category:manage（按钮节点 + 授权）
--    固定 ID 段 9105x：91051 已被 kb_qa_feedback 使用 → 从 91052 起。
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (91052, 1, 91010, 91032, 'kb_category_manage', '设置分类管理员', 3, NULL, NULL, 'kb:category:manage', NULL, 4, 1, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = v.id);

-- 授权给内置租户管理员 role_id=1（口径与 V14/V17 完全一致）
INSERT INTO sys_role_permission (id, role_id, perm_type, target_id, created_at)
SELECT m.id, 1, 'menu'::sys_perm_type, m.id, NOW()
FROM sys_menu m
WHERE m.id = 91052
  AND m.status = 1
  AND NOT EXISTS (
    SELECT 1 FROM sys_role_permission rp
    WHERE rp.role_id = 1 AND rp.perm_type = 'menu' AND rp.target_id = m.id
  )
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- C. API 级登记：让新增端点进入 ApiPermissionRegistry
--
-- 注册表查询（SysApiRepository.findRegistryRows）要求同时满足：
--   a.type = 'api' AND a.status = 1 AND a.http_method IS NOT NULL
--   AND a.path_pattern IS NOT NULL AND m.status = 1
--   且 a.module_id 必须能 JOIN 上 sys_module（KB 模块 id=91020，V13 写入）。
-- ---------------------------------------------------------------------------

-- C.1 catalog 节点：复用 V17 的 91060「知识库工具」；若目标库因故缺失则补齐（幂等）
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (91060, 91020, 0, '0090', 'catalog'::sys_api_node_type, '知识库工具', NULL::VARCHAR, NULL::VARCHAR, 90, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND EXISTS (SELECT 1 FROM sys_module WHERE id = 91020);

-- C.2 接口行（uk_api_method_path 是 (http_method, path_pattern) WHERE type='api' AND status=1
--     的部分唯一索引，故额外用 path 去重，避免将来 KB 全量补登记时重复插入同一路径）
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (91070, 91020, 91060, '0091', 'api'::sys_api_node_type, '分类管理员列表', 'GET',    '/api/v1/kb/categories/{id}/admins', 91, 1, NOW(), NOW()),
    (91071, 91020, 91060, '0092', 'api'::sys_api_node_type, '新增分类管理员', 'POST',   '/api/v1/kb/categories/{id}/admins', 92, 1, NOW(), NOW()),
    (91072, 91020, 91060, '0093', 'api'::sys_api_node_type, '移除分类管理员', 'DELETE', '/api/v1/kb/category-admins/{adminId}', 93, 1, NOW(), NOW()),
    (91073, 91020, 91060, '0094', 'api'::sys_api_node_type, '移动分类节点',   'PUT',    '/api/v1/kb/categories/{id}/move',    94, 1, NOW(), NOW()),
    (91074, 91020, 91060, '0095', 'api'::sys_api_node_type, '管辖分类ID',     'GET',    '/api/v1/kb/categories/manageable-ids', 95, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (
    SELECT 1 FROM sys_api a
    WHERE a.type = 'api' AND a.status = 1
      AND a.http_method = v.http_method AND a.path_pattern = v.path_pattern
  )
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 91060);

-- C.3 菜单 → 接口 关联
--     91070-91073 挂按钮 91052（permission=kb:category:manage，设置管理员/移动功能门控）；
--     91074（管辖分类 ID）挂页面菜单 91032（permission=kb:category:list，列表页即需）。
--     sys_menu_api 列 = (id, menu_id, api_id, sort, created_at)，V8 已 DROP uk_menu_api_api(api_id)。
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (91080, 91052, 91070, 1, NOW()),
    (91081, 91052, 91071, 1, NOW()),
    (91082, 91052, 91072, 1, NOW()),
    (91083, 91052, 91073, 1, NOW()),
    (91084, 91032, 91074, 1, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE menu_id = v.menu_id AND api_id = v.api_id)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = v.menu_id)
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = v.api_id);

-- ---------------------------------------------------------------------------
-- 迁移后自检（在你方环境执行 flyway migrate 后手工跑一遍）
--
--   -- 1) 按钮节点 + 页面菜单各权限码唯一（uk_menu_app_permission 不被绕过）
--   SELECT id, name, type, permission FROM sys_menu
--   WHERE app_id = 91010 AND permission IN ('kb:category:manage','kb:category:list') AND status = 1
--   ORDER BY id;
--   -- 期望：91032 | 分类管理 | 2 | kb:category:list；91052 | 设置分类管理员 | 3 | kb:category:manage
--
--   -- 2) 注册表里 5 条新规则，permission 与上表一一对应
--   SELECT a.http_method, a.path_pattern, m.permission
--   FROM sys_api a
--   JOIN sys_menu_api ma ON ma.api_id = a.id
--   JOIN sys_menu m      ON ma.menu_id = m.id
--   WHERE a.id BETWEEN 91070 AND 91074;
--   -- 期望：
--   --   GET    /api/v1/kb/categories/{id}/admins        | kb:category:manage
--   --   POST   /api/v1/kb/categories/{id}/admins        | kb:category:manage
--   --   DELETE /api/v1/kb/category-admins/{adminId}     | kb:category:manage
--   --   PUT    /api/v1/kb/categories/{id}/move          | kb:category:manage
--   --   GET    /api/v1/kb/categories/manageable-ids     | kb:category:list
--
--   -- 3) 授权存在
--   SELECT * FROM sys_role_permission WHERE role_id = 1 AND target_id = 91052;
--
--   -- 4) 表结构
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'kb_category_admin' ORDER BY ordinal_position;
-- ---------------------------------------------------------------------------
