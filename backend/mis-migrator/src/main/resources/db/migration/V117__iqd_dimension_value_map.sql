-- ===========================================================================
-- V117__iqd_dimension_value_map.sql —— 行级范围「MIS 值 ⇄ 数仓值」映射表
-- PostgreSQL 16 | 库名: mis_platform
--
-- 背景：X-Mis-Dept-Scope / X-Mis-Stores 里携带的是 mis-platform 自己的
--      部门 id（sys_dept.id）与门店 id；数仓业务表里存的是对方系统的部门/门店
--      编码（如 org_dept_code / shop_no），两套编码不是一回事。行级注入前必须
--      先把 MIS 侧值翻译成「该连接对应数仓」的外部编码。
--
-- 设计约束：
--   1. 真值只有一张表（本表）；不在 sys_dept/sys_store 上加对照列，避免第二处真值。
--   2. 映射必须带 connection_id（同一部门在 A 数仓叫 D001、B 数仓叫 dept_01）。
--   3. 支持 1:N（一个 MIS 部门可对应数仓多个编码，如子部门/门店群）。
--   4. 缺映射语义见 resolve 服务：
--        - store：无映射 → 该 store 无权限（丢弃）；全空 → fail-closed。
--        - dept ：锚点无直接映射 → 向下找「有映射的后代」作为限制范围。
--
-- 幂等：CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS。
-- ===========================================================================

CREATE TABLE IF NOT EXISTS iqd_dimension_value_map (
    id              BIGINT PRIMARY KEY,
    connection_id   BIGINT       NOT NULL,
    dimension_code  VARCHAR(32)  NOT NULL,                 -- dept | store | ...
    mis_value       VARCHAR(64)  NOT NULL,                 -- MIS 侧值：sys_dept.id / 门店 id（字符串）
    external_value  VARCHAR(128) NOT NULL,                 -- 数仓侧编码：org_dept_code / shop_no
    effective       SMALLINT     NOT NULL DEFAULT 1,       -- 1 生效 / 0 停用
    covers_subtree  SMALLINT     NOT NULL DEFAULT 1,       -- 1 ??(??) / 0 ??
    remark          VARCHAR(255) NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_iqd_dim_value_map_conn FOREIGN KEY (connection_id) REFERENCES iqd_connection(id),
    CONSTRAINT uk_iqd_dim_value_map UNIQUE (connection_id, dimension_code, mis_value, external_value),
    CONSTRAINT chk_iqd_dim_value_map_effective CHECK (effective IN (0, 1)),
    CONSTRAINT chk_iqd_dim_value_map_covers CHECK (covers_subtree IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_iqd_dim_value_map_lookup
    ON iqd_dimension_value_map(connection_id, dimension_code, mis_value, effective);

CREATE INDEX IF NOT EXISTS idx_iqd_dim_value_map_external
    ON iqd_dimension_value_map(connection_id, dimension_code, external_value);

-- 迁移后自检
--   SELECT connection_id, dimension_code, mis_value, external_value
--   FROM iqd_dimension_value_map ORDER BY connection_id, dimension_code, mis_value;
