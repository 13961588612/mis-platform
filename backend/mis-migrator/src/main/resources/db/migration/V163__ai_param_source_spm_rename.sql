-- V163__ai_param_source_spm_rename.sql
-- 既有参数槽位标明超市域：中文名加「超市」、source_code/wire_key 加 spm 前缀 | PostgreSQL 16 | 幂等

-- 1) 参数来源重命名（仅改 V160 种子的 4 条；已改过则跳过）
UPDATE ai_param_source
SET source_code = 'spm_auth_store',
    name = '超市权限门店',
    wire_key = 'spmStoreId',
    updated_at = NOW()
WHERE id = 10001
  AND source_code = 'auth_store';

UPDATE ai_param_source
SET source_code = 'spm_cal_biz_date',
    name = '超市经营日',
    wire_key = 'spmBizDate',
    updated_at = NOW()
WHERE id = 10002
  AND source_code = 'cal_biz_date';

UPDATE ai_param_source
SET source_code = 'spm_cal_ord_week',
    name = '超市经营周',
    wire_key = 'spmOrdWeek',
    updated_at = NOW()
WHERE id = 10003
  AND source_code = 'cal_ord_week';

UPDATE ai_param_source
SET source_code = 'spm_cal_ord_month',
    name = '超市经营月',
    wire_key = 'spmOrdMonth',
    updated_at = NOW()
WHERE id = 10004
  AND source_code = 'cal_ord_month';

-- 2) 样例报告槽位引用同步
UPDATE ai_report_def
SET slots_json = '[{"source_code":"spm_auth_store","required":true},{"source_code":"spm_cal_biz_date","required":true}]'::jsonb,
    description = '超市门店 + 超市经营日',
    updated_at = NOW()
WHERE id = 10030
  AND report_code = 'RPT_DAILY'
  AND slots_json::text LIKE '%"auth_store"%';

UPDATE ai_report_def
SET slots_json = '[{"source_code":"spm_auth_store","required":true},{"source_code":"spm_cal_ord_week","required":true}]'::jsonb,
    description = '超市门店 + 超市经营周',
    updated_at = NOW()
WHERE id = 10031
  AND report_code = 'RPT_WEEKLY'
  AND slots_json::text LIKE '%"auth_store"%';
