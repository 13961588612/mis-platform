-- ---------------------------------------------------------------------------
-- V75: iqd_ask_log 增补 simulated_role_code（B6 后台测试页模拟角色审计留痕）
--
-- W3 验收（T-W3-01 验收 2 / A8 边界）：审计记录 simulated_role_code 但不改真实
-- user_id。Worker 侧 write_ask_log 已透传该字段（有模拟则记录、无则 NULL）。
-- 本迁移仅为审计查询（/traces）暴露该字段，不参与任何判权。
-- ---------------------------------------------------------------------------
ALTER TABLE iqd_ask_log
    ADD COLUMN simulated_role_code VARCHAR(64) NULL;
