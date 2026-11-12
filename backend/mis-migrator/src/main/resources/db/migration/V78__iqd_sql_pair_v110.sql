-- ===========================================================================
-- V78__iqd_sql_pair_v110.sql —— 问数样本对 v1.10：方言转化 + 试运行 模型增量
-- PostgreSQL 16 | 库名: mis_platform
-- 前置：V71（iqd_sql_pair 结构：sql_text TEXT NOT NULL）；
--       V74（W4 端点/权限码/菜单绑定）。
--
-- 内容（v1.10 / architecture §4.2.3）：
--   1. iqd_sql_pair 表变更：
--        · RENAME COLUMN sql_text → wren_sql（WrenAI 方言，入库并推 WrenAI）
--        · ADD COLUMN source_dialect VARCHAR(32)（用户所选关系库类型）
--        · ADD COLUMN native_sql TEXT（用户手写原生 SQL，保留以便再编辑/再翻译）
--   2. 权限码 iqd:enhance:manage（sys_menu 92525，type=3，挂 92500 目录）
--   3. sys_api 92586/92587：/api/v1/iqd/sql-pairs/translate | /trial（POST）
--   4. sys_menu_api 92586/92587 → 92525（permission 由菜单侧 iqd:enhance:manage 提供）
--   5. sys_role_permission：授权内置租户管理员（role_id=1）
--
-- ⚠️ 段位说明：
--   sys_menu 92520-92524 被 V74 占用 → 本文件取 92525（空闲）。
--   sys_api 92576-92585 被 V74 占用 → 本文件取 92586/92587（空闲，code 0096 段续）。
-- 硬规则（同 V72/V73/V74）：每个 /api/v1/iqd/** 端点必须**同时**写 sys_api +
--   sys_menu_api（deny-unmapped=true 时只插一个表 → 40300「接口未授权映射」）。
-- 幂等：固定 ID + WHERE NOT EXISTS；append-only。
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. iqd_sql_pair 表变更（v1.10 模型增量）
-- ---------------------------------------------------------------------------
ALTER TABLE iqd_sql_pair RENAME COLUMN sql_text TO wren_sql;

ALTER TABLE iqd_sql_pair ADD COLUMN source_dialect VARCHAR(32);   -- oracle|mysql|postgres|clickhouse
ALTER TABLE iqd_sql_pair ADD COLUMN native_sql TEXT;              -- 用户手写原生 SQL（源方言）

-- ---------------------------------------------------------------------------
-- 2. sys_menu —— 权限码按钮 iqd:enhance:manage（type=3；不进侧栏，只承载 permission）
--    translate / trial 端点统一用此码（architecture §7.1；tasks.md T-W4-01 第 8 条）。
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (92525, 1, 92010, 92500, 'iqd-enhance-manage', '增强物料翻译/试运行', 3, NULL, NULL, 'iqd:enhance:manage', NULL, 25, 1, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu m WHERE m.app_id = 92010 AND m.permission = v.permission)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = 92500);

-- ---------------------------------------------------------------------------
-- 3. sys_api —— 2 个 v1.10 端点（module 92020；code 0096 段；父节点 92550）
-- ---------------------------------------------------------------------------
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (92586, 92020, 92550, '00960011', 'api'::sys_api_node_type, '样本对方言转化', 'POST',   '/api/v1/iqd/sql-pairs/translate', 11, 1, NOW(), NOW()),
    (92587, 92020, 92550, '00960012', 'api'::sys_api_node_type, '样本对试运行',   'POST',   '/api/v1/iqd/sql-pairs/trial',     12, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api a WHERE a.module_id = 92020 AND a.code = v.code)
  AND NOT EXISTS (
    SELECT 1 FROM sys_api a
    WHERE a.type = 'api' AND a.status = 1
      AND a.http_method = v.http_method
      AND a.path_pattern = v.path_pattern
  )
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 92550);

-- ---------------------------------------------------------------------------
-- 4. sys_menu_api —— 接口 ⇄ 菜单 绑定（permission 由菜单侧提供）
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (92586, 92525, 92586, 1, NOW()),   -- sql-pairs/translate → iqd:enhance:manage
    (92587, 92525, 92587, 1, NOW())    -- sql-pairs/trial      → iqd:enhance:manage
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (
    SELECT 1 FROM sys_menu_api ma WHERE ma.menu_id = v.menu_id AND ma.api_id = v.api_id
  )
  AND EXISTS (SELECT 1 FROM sys_menu m WHERE m.id = v.menu_id AND m.status = 1)
  AND EXISTS (SELECT 1 FROM sys_api  a WHERE a.id = v.api_id);

-- ---------------------------------------------------------------------------
-- 5. sys_role_permission —— 授权内置租户管理员（role_id=1）
-- ---------------------------------------------------------------------------
INSERT INTO sys_role_permission (id, role_id, perm_type, target_id, created_at)
SELECT m.id, 1, 'menu'::sys_perm_type, m.id, NOW()
FROM sys_menu m
WHERE m.id = 92525
  AND m.app_id = 92010
  AND m.status = 1
  AND NOT EXISTS (
    SELECT 1 FROM sys_role_permission rp
    WHERE rp.role_id = 1 AND rp.perm_type = 'menu' AND rp.target_id = m.id
  )
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 迁移后自检
--
--   -- 1) 列变更确认
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'iqd_sql_pair'
--     AND column_name IN ('wren_sql','source_dialect','native_sql')
--   ORDER BY column_name;
--
--   -- 2) 权限码 + 端点注册
--   SELECT a.http_method, a.path_pattern, m.permission
--   FROM sys_api a
--   JOIN sys_menu_api ma ON ma.api_id = a.id
--   JOIN sys_menu m      ON ma.menu_id = m.id
--   WHERE a.id IN (92586, 92587);
-- ---------------------------------------------------------------------------
