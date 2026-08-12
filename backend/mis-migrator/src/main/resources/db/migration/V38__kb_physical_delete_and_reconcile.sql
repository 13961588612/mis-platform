-- ===========================================================================
-- V38__kb_physical_delete_and_reconcile.sql
--   增量：恢复知识库/文档物理删除（官方批量接口）+ 文档级对账 + MISSING_IN_ENGINE 收敛
--   设计：docs/backend/ragflow-physical-delete-design-2026-08-12.md
--   前置：V37 为当前最新版本；本文件为 V38，Flyway 只追加不修改已发布版本。
--
--   内容：
--   A. kb_document 三列（文档级对账 + 收敛用，增量 P1 / T03、T04）：
--        engine_sync_status   SMALLINT NOT NULL DEFAULT 0
--                              (0未知/1一致/2引擎缺失/3名称漂移或同步失败)
--        engine_checked_at    TIMESTAMPTZ NULL  (最近一次与引擎对账时刻)
--        engine_missing_since TIMESTAMPTZ NULL  (连续被标记 MISSING_IN_ENGINE 起始时刻)
--   B. kb_library 一列（库级收敛用，增量 T04）：
--        engine_missing_since TIMESTAMPTZ NULL
--
--   幂等：ADD COLUMN IF NOT EXISTS / 固定 COMMENT；可重复执行。约束：不得修改已发布的 V1-V37。
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A. kb_document 引擎同步三列（T03 文档级对账 / T04 收敛）
-- ---------------------------------------------------------------------------
ALTER TABLE kb_document
    ADD COLUMN IF NOT EXISTS engine_sync_status   SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE kb_document
    ADD COLUMN IF NOT EXISTS engine_checked_at    TIMESTAMPTZ NULL;
ALTER TABLE kb_document
    ADD COLUMN IF NOT EXISTS engine_missing_since TIMESTAMPTZ NULL;

COMMENT ON COLUMN kb_document.engine_sync_status   IS '引擎同步状态(文档级对账)：0未知/1一致/2引擎缺失/3名称漂移或同步失败；建文档默认0';
COMMENT ON COLUMN kb_document.engine_checked_at    IS '最近一次与引擎对账(文档级)的时刻';
COMMENT ON COLUMN kb_document.engine_missing_since IS '连续被标记 MISSING_IN_ENGINE 的起始时刻(T04 收敛判定：达到阈值次数才清理)';

-- ---------------------------------------------------------------------------
-- B. kb_library 引擎缺失起始时刻（T04 库级收敛，软删前置）
-- ---------------------------------------------------------------------------
ALTER TABLE kb_library
    ADD COLUMN IF NOT EXISTS engine_missing_since TIMESTAMPTZ NULL;

COMMENT ON COLUMN kb_library.engine_missing_since IS '连续被标记 MISSING_IN_ENGINE 的起始时刻(T04 收敛判定：达到阈值次数才软删)';
