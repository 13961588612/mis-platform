-- V82__iqd_mdl_writeback_enabled_default.sql
-- 全环境默认开启 MDL 写回（U7/Q4 灰度闸门）：新连接默认 true，存量连接一次性翻 true。
-- 幂等：UPDATE 可重跑；ALTER DEFAULT 可重跑。

UPDATE iqd_connection
SET mdl_writeback_enabled = TRUE
WHERE mdl_writeback_enabled IS DISTINCT FROM TRUE;

ALTER TABLE iqd_connection
    ALTER COLUMN mdl_writeback_enabled SET DEFAULT TRUE;
