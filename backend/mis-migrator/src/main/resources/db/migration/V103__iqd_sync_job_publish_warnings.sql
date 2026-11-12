-- V103: iqd_sync_job 记录「发布后引擎侧自检」告警（2026-09-28）。
--
-- 背景：target/mdl.json 只是 `wren context build` 的产物，引擎（`wren context show` / MCP）
-- 读的是 **YAML 工程**。平台此前只看 build 退出码，于是「发布成功、界面显示已同步，
-- 但引擎侧没有 cube / 没读到规则」可以静默存在一整轮（真实事故：cube 与 relationship
-- 缺失，靠人工跑 `wren cube list` 才发现）。
--
-- 现在发布成功后读回 context show 与派生 MDL 对账，差异写本列，前端状态条据此提示。
-- 只追加一列，不改既有列；存 JSON 数组文本（与 unmatched_edits 同风格）。

ALTER TABLE iqd_sync_job
    ADD COLUMN IF NOT EXISTS publish_warnings text;

COMMENT ON COLUMN iqd_sync_job.publish_warnings IS
    '发布后引擎侧自检告警（JSON 字符串数组：如 ["自检：1 个cube未进引擎上下文（sale_by_store）"]）';
