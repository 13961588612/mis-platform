-- V79__iqd_sync_job_and_catalog_editable.sql
-- 问数闭环补全一期（P0-1~P0-4 / P1-1 / P1-2）：
--   1) iqd_catalog_item 增加 editable 列（二期平台内建/改前向占位，一期恒 false）
--   2) 新建 iqd_sync_job（按连接记录「整库 rebuild（context build）+ memory index + 回填」作业）
-- 落点说明：mis-iqd 模块 ddl-auto=validate，SQL 统一由 mis-migrator Flyway 管理（见 V71）。
-- 幂等：ALTER 用 ADD COLUMN IF NOT EXISTS（PG 12+）；建表用 CREATE TABLE IF NOT EXISTS；
--       索引用 CREATE INDEX IF NOT EXISTS。可安全重跑。

-- ① catalog editable 前向列：二期平台内建/改 catalog 预留，一期恒 0（不暴露 UI 写入口）
ALTER TABLE iqd_catalog_item ADD COLUMN IF NOT EXISTS editable SMALLINT NOT NULL DEFAULT 0;

-- ② 同步作业表：整库 rebuild 一次一行（按连接覆盖写），由 ai-platform 经 IqdConfigClient 回调写回
CREATE TABLE IF NOT EXISTS iqd_sync_job (
    id                       BIGINT PRIMARY KEY,
    connection_id            BIGINT       NOT NULL,
    build_status             VARCHAR(16)  NOT NULL DEFAULT 'pending',   -- pending|running|success|failed
    build_mdl_hash           VARCHAR(128) NULL,                        -- context build 返回的 mdl_hash（解析失败回退 wqd-*）
    index_status             VARCHAR(16)  NOT NULL DEFAULT 'pending',   -- pending|running|success|failed
    build_at                 TIMESTAMPTZ  NULL,
    index_at                 TIMESTAMPTZ  NULL,
    synced_sql_pair_count    INT          NOT NULL DEFAULT 0,
    synced_knowledge_count   INT          NOT NULL DEFAULT 0,
    build_error              TEXT         NULL,
    index_error              TEXT         NULL,
    created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_iqd_sync_job_conn FOREIGN KEY (connection_id) REFERENCES iqd_connection(id)
);
CREATE INDEX IF NOT EXISTS idx_iqd_sync_job_conn ON iqd_sync_job(connection_id, updated_at DESC);
