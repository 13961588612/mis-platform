-- recon-service Flyway V6：recon_report_run 补 diff_amount_sum 列（报告中心 R84，单位分）。
-- 用途：报告记录列表「差异金额合计」列；报告收尾时按本次扫描差异行金额求和落列，可排序/检索。
ALTER TABLE recon_report_run ADD COLUMN IF NOT EXISTS diff_amount_sum BIGINT DEFAULT 0;
