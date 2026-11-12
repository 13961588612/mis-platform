-- V148__iqd_sql_pair_category.sql
-- 问数样本对树形分类（按连接隔离）+ 样本挂 category_id | PostgreSQL 16 | 幂等
--
-- ## 背景
--   知识与规则 → 样本对 Tab：样本过多混在一起难管；按 connection 建邻接树，
--   样本可空软引用 category_id。分类仅服务管理筛选，不裁剪 Wren / few-shot。
--
-- ## 本迁移
--   1) 建 iqd_sql_pair_category
--   2) iqd_sql_pair 追加 category_id + 索引
--   3) 登记分类 CRUD API → iqd:enhance:view / save
--
-- ## 段位
--   sys_api 92980-92983 / sys_menu_api 92984-92987 / code 00960120-00960123
--   → 菜单 92521(view) / 92522(save)
--
-- ## ⚠️ 只追加；绝不修改既有迁移（checksum）。

-- ===========================================================================
-- 1) 样本对分类表（按连接邻接树；parent_id=0 为根）
-- ===========================================================================
CREATE TABLE IF NOT EXISTS iqd_sql_pair_category (
    id             BIGINT       PRIMARY KEY,
    connection_id  BIGINT       NOT NULL,
    parent_id      BIGINT       NOT NULL DEFAULT 0,
    code           VARCHAR(64)  NOT NULL,
    name           VARCHAR(128) NOT NULL,
    sort_order     INT          NOT NULL DEFAULT 0,
    enabled        SMALLINT     NOT NULL DEFAULT 1,
    created_by     BIGINT       NULL,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_iqd_sql_pair_category_code UNIQUE (connection_id, code),
    CONSTRAINT fk_iqd_sql_pair_category_conn FOREIGN KEY (connection_id) REFERENCES iqd_connection(id)
);

CREATE INDEX IF NOT EXISTS idx_iqd_sql_pair_category_tree
    ON iqd_sql_pair_category (connection_id, parent_id, sort_order);

-- ===========================================================================
-- 2) 样本对挂载分类（软引用、无 FK；NULL = 未分类）
-- ===========================================================================
ALTER TABLE iqd_sql_pair ADD COLUMN IF NOT EXISTS category_id BIGINT NULL;

CREATE INDEX IF NOT EXISTS idx_iqd_sql_pair_conn_category
    ON iqd_sql_pair (connection_id, category_id);

-- ===========================================================================
-- 3) sys_api —— 分类树 / CRUD（列名对齐 V8 后：module_id / type / http_method / path_pattern / sort）
-- ===========================================================================
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.id, v.module_id, v.parent_id, v.code, v.type, v.name, v.http_method, v.path_pattern, v.sort, v.status, v.created_at, v.updated_at
FROM (VALUES
    (92980, 92020, 92550, '00960120', 'api'::sys_api_node_type, '样本对分类树',   'GET',    '/api/v1/iqd/sql-pair-categories/tree',            120, 1, NOW(), NOW()),
    (92981, 92020, 92550, '00960121', 'api'::sys_api_node_type, '样本对分类新建', 'POST',   '/api/v1/iqd/sql-pair-categories',                 121, 1, NOW(), NOW()),
    (92982, 92020, 92550, '00960122', 'api'::sys_api_node_type, '样本对分类更新', 'PUT',    '/api/v1/iqd/sql-pair-categories/{id:[0-9]+}',     122, 1, NOW(), NOW()),
    (92983, 92020, 92550, '00960123', 'api'::sys_api_node_type, '样本对分类删除', 'DELETE', '/api/v1/iqd/sql-pair-categories/{id:[0-9]+}',     123, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api a WHERE a.id = v.id)
  AND NOT EXISTS (
    SELECT 1 FROM sys_api a
    WHERE a.type = 'api' AND a.status = 1
      AND a.http_method = v.http_method
      AND a.path_pattern = v.path_pattern
  )
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 92550);

-- ===========================================================================
-- 4) sys_menu_api —— view / save
-- ===========================================================================
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (92984, 92521, 92980, 1, NOW()),   -- tree   → iqd:enhance:view
    (92985, 92522, 92981, 1, NOW()),   -- create → iqd:enhance:save
    (92986, 92522, 92982, 1, NOW()),   -- update → iqd:enhance:save
    (92987, 92522, 92983, 1, NOW())    -- delete → iqd:enhance:save
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = v.menu_id)
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = v.api_id);
