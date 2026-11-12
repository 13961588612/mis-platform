-- V164__ai_report_slots_spm_source_fix.sql
-- 修复 V163 后仍引用旧 source_code 的报告槽位（prepare-card 报「未知参数来源: auth_store」）
-- PostgreSQL 16 | 幂等

-- 1) 参数来源若仍为旧码则再改一次（V163 已改则 0 行）
UPDATE ai_param_source
SET source_code = 'spm_auth_store', name = '超市权限门店', wire_key = 'spmStoreId', updated_at = NOW()
WHERE source_code = 'auth_store';

UPDATE ai_param_source
SET source_code = 'spm_cal_biz_date', name = '超市经营日', wire_key = 'spmBizDate', updated_at = NOW()
WHERE source_code = 'cal_biz_date';

UPDATE ai_param_source
SET source_code = 'spm_cal_ord_week', name = '超市经营周', wire_key = 'spmOrdWeek', updated_at = NOW()
WHERE source_code = 'cal_ord_week';

UPDATE ai_param_source
SET source_code = 'spm_cal_ord_month', name = '超市经营月', wire_key = 'spmOrdMonth', updated_at = NOW()
WHERE source_code = 'cal_ord_month';

-- 2) 全部报告 slots_json：旧 source_code → spm_*
UPDATE ai_report_def d
SET slots_json = sub.new_slots,
    updated_at = NOW()
FROM (
    SELECT r.id AS rid,
           jsonb_agg(
               CASE e.elem->>'source_code'
                   WHEN 'auth_store' THEN jsonb_set(e.elem, '{source_code}', '"spm_auth_store"')
                   WHEN 'cal_biz_date' THEN jsonb_set(e.elem, '{source_code}', '"spm_cal_biz_date"')
                   WHEN 'cal_ord_week' THEN jsonb_set(e.elem, '{source_code}', '"spm_cal_ord_week"')
                   WHEN 'cal_ord_month' THEN jsonb_set(e.elem, '{source_code}', '"spm_cal_ord_month"')
                   ELSE e.elem
               END
               ORDER BY e.ord
           ) AS new_slots
    FROM ai_report_def r
    CROSS JOIN LATERAL jsonb_array_elements(
        CASE
            WHEN r.slots_json IS NULL THEN '[]'::jsonb
            WHEN jsonb_typeof(r.slots_json) = 'array' THEN r.slots_json
            ELSE '[]'::jsonb
        END
    ) WITH ORDINALITY AS e(elem, ord)
    WHERE EXISTS (
        SELECT 1
        FROM jsonb_array_elements(
            CASE
                WHEN r.slots_json IS NULL THEN '[]'::jsonb
                WHEN jsonb_typeof(r.slots_json) = 'array' THEN r.slots_json
                ELSE '[]'::jsonb
            END
        ) x
        WHERE x->>'source_code' IN ('auth_store', 'cal_biz_date', 'cal_ord_week', 'cal_ord_month')
    )
    GROUP BY r.id
) sub
WHERE d.id = sub.rid;
