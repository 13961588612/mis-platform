-- ===========================================================================
-- V93__iqd_catalog_item_model_ref_fix.sql
-- 修复：V89 在部分环境被记录为已执行，但 ADD COLUMN model_ref 未实际落地
-- （checksum repair 只改历史表，不会重跑旧脚本）。本迁移幂等补列。
-- 前置：V89（建模台 model_ref + MCP 种子，理想态已含本 DDL）
-- ===========================================================================

ALTER TABLE iqd_catalog_item ADD COLUMN IF NOT EXISTS model_ref VARCHAR(255);

COMMENT ON COLUMN iqd_catalog_item.model_ref IS
    'Cube 所属模型 item_key（如 mdl:model:orders）；仅 kind=cube 使用。NULL=未记录。V89 引入，V93 幂等补齐。';
