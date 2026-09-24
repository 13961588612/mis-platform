-- ===========================================================================
-- V97__iqd_connection_default_connector_type_fix.sql
-- 修复：V94 在部分环境被记为已执行，但 default_connector 仍为 BIGINT
-- （与 V93/V95 同类：checksum repair 不重跑旧脚本）。本迁移幂等纠偏。
-- 前置：V71（VARCHAR 设计）；V94（理想态已纠偏）
-- ===========================================================================

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'iqd_connection'
          AND column_name = 'default_connector'
          AND data_type = 'bigint'
    ) THEN
        ALTER TABLE iqd_connection
            ALTER COLUMN default_connector TYPE VARCHAR(128)
            USING (
                CASE
                    WHEN default_connector IS NULL THEN NULL
                    ELSE default_connector::text
                END
            );
    END IF;
END $$;

COMMENT ON COLUMN iqd_connection.default_connector IS
    '默认连接器类型（如 postgres）；V71 定义 VARCHAR，V94/V97 幂等纠偏错误 BIGINT。';
