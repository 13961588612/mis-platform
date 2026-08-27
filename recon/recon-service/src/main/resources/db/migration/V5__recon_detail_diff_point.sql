-- recon-service Flyway V5：recon_detail 补 diff_point 列。
-- 用途：非货币计量（积分）差额原值（V33：积分不是钱，不进 diff_amount_cent 金钱分语义），
--       供报告显示「积分差额」。比较规则 diff_unit=point 时写入（field_mismatch=|左-右|，unmatched=本侧值）。
ALTER TABLE recon_detail ADD COLUMN IF NOT EXISTS diff_point BIGINT;
