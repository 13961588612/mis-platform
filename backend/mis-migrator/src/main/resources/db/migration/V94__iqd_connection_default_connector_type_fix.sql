-- ===========================================================================
-- V94__iqd_connection_default_connector_type_fix.sql
-- 修复：部分环境 iqd_connection.default_connector 被建成 BIGINT（应为 VARCHAR）
-- Hibernate validate：found int8，expecting varchar。
-- 设计对齐 V71（VARCHAR(128)）；无业务数据依赖该列（现有行均为 NULL）。
-- ===========================================================================

ALTER TABLE iqd_connection
    ALTER COLUMN default_connector TYPE VARCHAR(128)
    USING (
        CASE
            WHEN default_connector IS NULL THEN NULL
            ELSE default_connector::text
        END
    );

COMMENT ON COLUMN iqd_connection.default_connector IS
    '默认连接器类型（如 postgres）；V71 定义 VARCHAR，V94 幂等纠偏错误 BIGINT。';
