-- recon-service Flyway V4：差异状态流转历史表 + recon_detail 补 confirmed_at 列。
-- 用途：差异处理详情页流转时间线（pending→confirmed→reported→resolved / handle_status 流转）。
-- VerdictService 4 处状态变更点 + DiffHandleService.handle/revert 写入。
-- confirmed_at 补全 V1 缺失的 confirmed 时间戳（pending_at/reported_at/resolved_at V1 已有）。
ALTER TABLE recon_detail ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS recon_diff_status_history (
    id              BIGSERIAL PRIMARY KEY,
    detail_id       BIGINT NOT NULL,
    field           VARCHAR(16) NOT NULL,        -- status / handle_status
    from_value      VARCHAR(32),                 -- NULL 表示新建（首次入池）
    to_value        VARCHAR(32) NOT NULL,
    reason          VARCHAR(64),                 -- first_unmatched / peer_advanced / timeout / reopened / matched / manual_handle / manual_revert
    operator        VARCHAR(64),                 -- 人工操作时填，引擎流转为 NULL
    created_at      TIMESTAMP DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_diff_status_history_detail ON recon_diff_status_history(detail_id, id);
