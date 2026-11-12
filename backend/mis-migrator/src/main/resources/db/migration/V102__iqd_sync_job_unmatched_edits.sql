-- V102: iqd_sync_job 记录「已编辑但未落入 MDL」的节点清单（T03e 可见性 → 前端提示）。
--
-- 背景：Worker 在 `build_mdl_from_catalog` 里会收集「编辑了但没能进派生 MDL」的节点
-- （如全新建 model / view / metric —— 刻意不物化，详见 _collect_unmatched_edits 的注释）。
-- 此前该清单只写进 payload 与日志，前端看不到，用户在建模台保存成功后会误以为已生效。
--
-- 只追加两列，不改既有列；`unmatched_edits` 存 JSON 数组文本（与 build_error 同为 text）。

ALTER TABLE iqd_sync_job
    ADD COLUMN IF NOT EXISTS unmatched_edit_count integer NOT NULL DEFAULT 0;

ALTER TABLE iqd_sync_job
    ADD COLUMN IF NOT EXISTS unmatched_edits text;

COMMENT ON COLUMN iqd_sync_job.unmatched_edit_count IS
    '本次派生 MDL 时「已编辑但未落入」的节点数（T03e；0=全部生效）';
COMMENT ON COLUMN iqd_sync_job.unmatched_edits IS
    '未落入 MDL 的节点清单（JSON 数组文本：[{item_key,kind,parent_key,display_name}]）';
