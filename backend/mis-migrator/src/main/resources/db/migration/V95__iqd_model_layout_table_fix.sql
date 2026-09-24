-- ===========================================================================
-- V95__iqd_model_layout_table_fix.sql
-- 修复：V87 在部分环境被记录为已执行，但 CREATE TABLE iqd_model_layout 未落地
-- （与 V93 model_ref 同类问题：checksum repair 不重跑旧脚本）。本迁移幂等建表。
-- 前置：V71（iqd_connection）；V87（理想态已含本 DDL）
-- ===========================================================================

CREATE TABLE IF NOT EXISTS iqd_model_layout (
    id                  BIGINT PRIMARY KEY,
    connection_id       BIGINT       NOT NULL,
    layout_json         JSONB        NOT NULL,
    viewport_json       JSONB        NULL,
    auto_layout_version INT          NOT NULL DEFAULT 0,
    updated_by          VARCHAR(64)  NULL,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    version             INT          NOT NULL DEFAULT 0,
    CONSTRAINT uk_iqd_model_layout_conn UNIQUE (connection_id),
    CONSTRAINT fk_iqd_model_layout_conn FOREIGN KEY (connection_id) REFERENCES iqd_connection(id)
);

CREATE INDEX IF NOT EXISTS idx_iqd_ml_conn ON iqd_model_layout (connection_id);

COMMENT ON TABLE  iqd_model_layout IS '问数建模台画布布局（连接级，视图数据；MR-S4）。V87 引入，V95 幂等补齐。';
COMMENT ON COLUMN iqd_model_layout.layout_json IS '画布节点坐标 + 边锚点 JSONB（{nodes,edges}）';
COMMENT ON COLUMN iqd_model_layout.viewport_json IS '画布视口 JSONB（{x,y,zoom}）';
COMMENT ON COLUMN iqd_model_layout.auto_layout_version IS '最近一次自动布局覆盖版本（0=未自动布局过）';
COMMENT ON COLUMN iqd_model_layout.version IS 'PUT 乐观并发基线（body.base_version 不符 → 40900）';
