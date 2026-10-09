-- V124__wf_edge.sql
-- 流程边表：把「设计器画布上的连线」持久化，支撑图式流转（条件分支 / 会签路由）。
-- 幂等：IF NOT EXISTS。
--
-- 背景：V121 只建了 wf_node（含 sort_order），后端按 sort_order 线性推进，
-- 无法表达条件分支（一个节点多个出口）与汇合。本表补充显式有向边。

CREATE TABLE IF NOT EXISTS wf_edge (
    id             BIGINT PRIMARY KEY,
    definition_id  BIGINT       NOT NULL REFERENCES wf_definition (id),
    source_node    VARCHAR(64)  NOT NULL,     -- 源节点 node_code
    target_node    VARCHAR(64)  NOT NULL,     -- 目标节点 node_code
    edge_type      VARCHAR(16)  NOT NULL DEFAULT 'DEFAULT',  -- DEFAULT / CONDITION_YES / CONDITION_NO / REJECT
    label          VARCHAR(128) NULL,         -- 分支标签（如「是」「否」）
    condition_expr TEXT         NULL,         -- 该边条件（可空=无条件）
    sort_order     INT          NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_wf_edge UNIQUE (definition_id, source_node, target_node, edge_type)
);

CREATE INDEX IF NOT EXISTS idx_wf_edge_def_source ON wf_edge (definition_id, source_node);
