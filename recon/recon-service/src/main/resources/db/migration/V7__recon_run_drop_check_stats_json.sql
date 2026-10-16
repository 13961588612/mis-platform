-- recon-service Flyway V7：撤回 recon_run.check_stats_json 列（对账汇总 v1.3 / 方案 §14.4）。
-- 背景：早期 V6 曾以该列承载按 check 汇总统计，v1.3 改为台账+差异池聚合后撤回。
--      列从未写入数据，直接 DROP；未建过该列的环境走 IF EXISTS 空转。
ALTER TABLE recon_run DROP COLUMN IF EXISTS check_stats_json;
