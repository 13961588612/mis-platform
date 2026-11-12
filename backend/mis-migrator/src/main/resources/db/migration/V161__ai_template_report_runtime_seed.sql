-- V161__ai_template_report_runtime_seed.sql
-- S3：门店维度 + 日历种子 + catalog/prepare/execute API | PostgreSQL 16 | 幂等

-- ===========================================================================
-- 1) 门店主数据（权限 target_id 对齐；无 org 门店表时用本表）
-- ===========================================================================
CREATE TABLE IF NOT EXISTS ai_report_store_dim (
    id          BIGINT       PRIMARY KEY,
    store_code  VARCHAR(32)  NOT NULL,
    store_name  VARCHAR(128) NOT NULL,
    enabled     SMALLINT     NOT NULL DEFAULT 1,
    CONSTRAINT uk_ai_report_store_dim_code UNIQUE (store_code)
);

INSERT INTO ai_report_store_dim (id, store_code, store_name, enabled)
SELECT v.* FROM (VALUES
    (20001, '6001', '大统华徐汇店', 1::smallint),
    (20002, '6002', '大统华静安店', 1::smallint),
    (20003, '6003', '大统华浦东店', 1::smallint)
) AS v(id, store_code, store_name, enabled)
WHERE NOT EXISTS (SELECT 1 FROM ai_report_store_dim s WHERE s.id = v.id OR s.store_code = v.store_code);

-- ===========================================================================
-- 2) 经营日 / 周 / 月日历（近窗，供 Handler 查库）
-- ===========================================================================
INSERT INTO ai_report_calendar_day (biz_date, label, enabled)
SELECT d::date,
       to_char(d::date, 'YYYY-MM-DD'),
       1
FROM generate_series(CURRENT_DATE - INTERVAL '120 days', CURRENT_DATE - INTERVAL '1 day', INTERVAL '1 day') AS d
WHERE NOT EXISTS (
    SELECT 1 FROM ai_report_calendar_day c WHERE c.biz_date = d::date
);

INSERT INTO ai_report_calendar_week (ord_week, label, week_start, week_end, enabled)
SELECT
    to_char(week_start, 'IYYY') || '-W' || to_char(week_start, 'IW') AS ord_week,
    to_char(week_start, 'IYYY') || '-W' || to_char(week_start, 'IW')
        || '（' || to_char(week_start, 'MM-DD') || '~' || to_char(week_end, 'MM-DD') || '）' AS label,
    week_start,
    week_end,
    1
FROM (
    SELECT
        (date_trunc('week', d::timestamp)::date) AS week_start,
        (date_trunc('week', d::timestamp)::date + 6) AS week_end
    FROM generate_series(CURRENT_DATE - INTERVAL '200 days', CURRENT_DATE - INTERVAL '7 days', INTERVAL '7 days') AS d
) w
WHERE NOT EXISTS (
    SELECT 1 FROM ai_report_calendar_week c
    WHERE c.ord_week = to_char(w.week_start, 'IYYY') || '-W' || to_char(w.week_start, 'IW')
);

INSERT INTO ai_report_calendar_month (ord_month, label, month_start, month_end, enabled)
SELECT
    to_char(month_start, 'YYYY-MM') AS ord_month,
    to_char(month_start, 'YYYY年MM月') AS label,
    month_start,
    (month_start + INTERVAL '1 month - 1 day')::date AS month_end,
    1
FROM (
    SELECT date_trunc('month', d::timestamp)::date AS month_start
    FROM generate_series(CURRENT_DATE - INTERVAL '540 days', CURRENT_DATE - INTERVAL '1 month', INTERVAL '1 month') AS d
) m
WHERE NOT EXISTS (
    SELECT 1 FROM ai_report_calendar_month c
    WHERE c.ord_month = to_char(m.month_start, 'YYYY-MM')
);

-- ===========================================================================
-- 3) API：catalog / prepare-card / execute（view 绑 catalog+prepare；execute 也挂 view 便于 Copilot）
-- ===========================================================================
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.id, v.module_id, v.parent_id, v.code, v.type, v.name, v.http_method, v.path_pattern, v.sort, v.status, v.created_at, v.updated_at
FROM (VALUES
    (93228, 92020, 93210, '00980118', 'api'::sys_api_node_type, '报告分组目录',     'GET',  '/api/v1/ai-reports/catalog',       18, 1, NOW(), NOW()),
    (93229, 92020, 93210, '00980119', 'api'::sys_api_node_type, '报告参数卡准备',   'POST', '/api/v1/ai-reports/prepare-card', 19, 1, NOW(), NOW()),
    (93230, 92020, 93210, '00980120', 'api'::sys_api_node_type, '报告执行',         'POST', '/api/v1/ai-reports/execute',      20, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api a WHERE a.id = v.id)
  AND NOT EXISTS (
    SELECT 1 FROM sys_api a
    WHERE a.type = 'api' AND a.status = 1
      AND a.http_method = v.http_method
      AND a.path_pattern = v.path_pattern
  )
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 93210);

INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (93260, 93201, 93228, 8, NOW()),
    (93261, 93201, 93229, 9, NOW()),
    (93262, 93201, 93230, 10, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = v.menu_id)
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = v.api_id);

-- Copilot 用户常用 ai:chat:use；将 catalog/prepare/execute 也绑到问数旗舰页权限，便于会话侧调用
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (93263, 93040, 93228, 90, NOW()),
    (93264, 93040, 93229, 91, NOW()),
    (93265, 93040, 93230, 92, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = v.menu_id)
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = v.api_id);
