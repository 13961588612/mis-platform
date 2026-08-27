-- V80__iqd_edit_state.sql
-- 问数二期「语义模型编辑能力」编辑态数据模型（T01）：
--   1) iqd_connection 增加编辑版本/写回闸门/基线 MDL/漂移标记
--   2) iqd_catalog_item 增加 edit_revision / wren_ref_id（节点级编辑态 + 批量盖章）
--   3) iqd_sync_job 增加 edit_revision / edit_source（model 写回来源）
--   4) 新建 iqd_edit_idempotency（编辑幂等去重表，P0-12）
-- 落点说明：mis-iqd 模块 ddl-auto=validate，SQL 统一由 mis-migrator Flyway 管理（见 V71）。
-- 幂等：ALTER 用 ADD COLUMN IF NOT EXISTS（PG 12+）；建表用 CREATE TABLE IF NOT EXISTS；
--       索引用 CREATE INDEX IF NOT EXISTS；可安全重跑。
-- 补充项（G7/S3/P0-12，见设计 §三/§九③）：mdl_raw(JSONB) / stale_drift / iqd_edit_idempotency。

-- ===================== iqd_connection =====================
ALTER TABLE iqd_connection
    ADD COLUMN IF NOT EXISTS current_edit_revision BIGINT       NOT NULL DEFAULT 0,   -- 平台当前编辑版本（单调递增）
    ADD COLUMN IF NOT EXISTS built_edit_revision  BIGINT       NOT NULL DEFAULT 0,   -- 已写回 WrenAI 的版本
    ADD COLUMN IF NOT EXISTS mdl_writeback_enabled BOOLEAN     NOT NULL DEFAULT FALSE,-- 按连接灰度闸门（U7/Q4）
    ADD COLUMN IF NOT EXISTS built_mdl_hash       VARCHAR(255),                      -- 最近一次成功写回的 mdl_hash
    ADD COLUMN IF NOT EXISTS mdl_raw              JSONB,                             -- 【G7】基线完整 MDL 快照
    ADD COLUMN IF NOT EXISTS stale_drift          BOOLEAN     NOT NULL DEFAULT FALSE;-- 【S3】外部漂移标记

-- 仅对漂移中连接建部分索引，便于对账扫描
CREATE INDEX IF NOT EXISTS idx_iqd_conn_stale_drift
    ON iqd_connection (stale_drift) WHERE stale_drift = TRUE;

-- ===================== iqd_catalog_item =====================
-- source 列一期已存在：取值 {db_meta(默认) | mdl | platform_edit(新增)}，无需 DDL
ALTER TABLE iqd_catalog_item
    ADD COLUMN IF NOT EXISTS edit_revision BIGINT,       -- 该节点最后被平台编辑所属 revision；NULL=从未编辑
    ADD COLUMN IF NOT EXISTS wren_ref_id  VARCHAR(255);  -- 该节点被编入的 mdl_hash（批量回填盖章）；NULL=未同步

CREATE INDEX IF NOT EXISTS idx_iqd_ci_edit_rev
    ON iqd_catalog_item (connection_id, edit_revision);

-- ===================== iqd_sync_job =====================
ALTER TABLE iqd_sync_job
    ADD COLUMN IF NOT EXISTS edit_revision BIGINT,       -- 本次 build 对应连接 revision
    ADD COLUMN IF NOT EXISTS edit_source   VARCHAR(32);  -- materials | model

-- ===================== 幂等去重表（P0-12）=====================
CREATE TABLE IF NOT EXISTS iqd_edit_idempotency (
    idempotency_key VARCHAR(64)  NOT NULL,
    connection_id   BIGINT       NOT NULL,
    edit_revision   BIGINT       NOT NULL,
    created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (connection_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_iqd_edit_idem_conn
    ON iqd_edit_idempotency (connection_id, created_at DESC);
