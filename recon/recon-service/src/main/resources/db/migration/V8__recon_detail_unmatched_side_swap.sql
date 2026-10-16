-- recon-service Flyway V8：unmatched diff_type 口径修正（引擎按"缺失的侧"命名，2026-08-31）。
-- 需求《后台原型需求说明书-第一批-线上订单.md》缺失差异口径：订单侧有、微信侧没有 → unmatched_right（右侧缺失），
-- diff_type 按"缺失的侧"命名（unmatched_left=左侧缺失 / unmatched_right=右侧缺失）。
-- 原引擎按"有数据的侧"命名（unmatched_left=左有右无）与需求相反，VerdictService 已修正；
-- 本迁移交换存量差异的 diff_type，保持新旧数据口径一致：
--   unmatched_left  → unmatched_right（右侧有、左侧缺失，即左侧缺失）
--   unmatched_right → unmatched_left（左侧有、右侧缺失，即右侧缺失）
-- 数据面板 left_data_json / right_data_json、diff_desc（"仅{有数据侧}有"）、anchors(side=row 实际侧)
-- 均按 row 实际侧存储，不受 diff_type 交换影响，无需迁移。
UPDATE recon_detail
   SET diff_type = CASE diff_type
       WHEN 'unmatched_left' THEN 'unmatched_right'
       WHEN 'unmatched_right' THEN 'unmatched_left'
       ELSE diff_type
   END;
