-- V160__ai_template_report_menu_seed.sql
-- 模板报告：菜单/权限/API + 参数来源/样例报告种子 | PostgreSQL 16 | 幂等
--
-- ## ID 段（核实空闲）
--   sys_menu 93200-93202；sys_api 93210-93229；sys_menu_api 93240-93259
--   sys_role_permission 93270-93272
--   业务种子 id：10001+（远离运行时 IdGenerator 时间戳量级）
--
-- ## 权限码
--   ai-report:view / ai-report:save
--
-- ⚠️ 只追加。

-- ===========================================================================
-- 1) 菜单：问数 App 下「报告管理」
-- ===========================================================================
INSERT INTO sys_menu (
    id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at
)
SELECT v.* FROM (VALUES
    (93200, 1, 93010, 93030, 'ai-report-page', '报告管理', 2, '/iqd/reports', 'agent/iqd/iqd-report-admin-page', NULL, 'FileText', 20, 1, 1, NOW(), NOW()),
    (93201, 1, 93010, 93200, 'ai-report-view', '报告查看', 3, NULL, NULL, 'ai-report:view', NULL, 1, 1, 1, NOW(), NOW()),
    (93202, 1, 93010, 93200, 'ai-report-save', '报告保存', 3, NULL, NULL, 'ai-report:save', NULL, 2, 1, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu m WHERE m.id = v.id)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = 93030);

INSERT INTO sys_role_permission (id, role_id, perm_type, target_id, created_at)
SELECT v.id, 1, 'menu'::sys_perm_type, v.target_id, NOW()
FROM (VALUES
    (93270, 93200),
    (93271, 93201),
    (93272, 93202)
) AS v(id, target_id)
WHERE NOT EXISTS (
        SELECT 1 FROM sys_role_permission rp
        WHERE rp.role_id = 1 AND rp.perm_type = 'menu'::sys_perm_type AND rp.target_id = v.target_id)
  AND EXISTS (SELECT 1 FROM sys_menu m WHERE m.id = v.target_id AND m.status = 1)
  AND EXISTS (SELECT 1 FROM sys_role r WHERE r.id = 1);

-- ===========================================================================
-- 2) sys_api catalog + 端点
-- ===========================================================================
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.id, v.module_id, v.parent_id, v.code, v.type, v.name, v.http_method, v.path_pattern, v.sort, v.status, v.created_at, v.updated_at
FROM (VALUES
    (93210, 92020, 0, '00980100', 'catalog'::sys_api_node_type, '模板报告', NULL, NULL, 180, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api a WHERE a.id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api a WHERE a.module_id = 92020 AND a.code = v.code);

INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.id, v.module_id, v.parent_id, v.code, v.type, v.name, v.http_method, v.path_pattern, v.sort, v.status, v.created_at, v.updated_at
FROM (VALUES
    (93211, 92020, 93210, '00980101', 'api'::sys_api_node_type, '报告探活',           'GET',    '/api/v1/ai-reports/ping',                         1, 1, NOW(), NOW()),
    (93212, 92020, 93210, '00980102', 'api'::sys_api_node_type, '报告分类树',         'GET',    '/api/v1/ai-reports/categories/tree',              2, 1, NOW(), NOW()),
    (93213, 92020, 93210, '00980103', 'api'::sys_api_node_type, '报告分类新建',       'POST',   '/api/v1/ai-reports/categories',                   3, 1, NOW(), NOW()),
    (93214, 92020, 93210, '00980104', 'api'::sys_api_node_type, '报告分类更新',       'PUT',    '/api/v1/ai-reports/categories/{id:[0-9]+}',       4, 1, NOW(), NOW()),
    (93215, 92020, 93210, '00980105', 'api'::sys_api_node_type, '报告分类删除',       'DELETE', '/api/v1/ai-reports/categories/{id:[0-9]+}',       5, 1, NOW(), NOW()),
    (93216, 92020, 93210, '00980106', 'api'::sys_api_node_type, '参数来源列表',       'GET',    '/api/v1/ai-reports/param-sources',                6, 1, NOW(), NOW()),
    (93217, 92020, 93210, '00980107', 'api'::sys_api_node_type, '工作流平台列表',     'GET',    '/api/v1/ai-reports/workflow-platforms',           7, 1, NOW(), NOW()),
    (93218, 92020, 93210, '00980108', 'api'::sys_api_node_type, '工作流平台新建',     'POST',   '/api/v1/ai-reports/workflow-platforms',           8, 1, NOW(), NOW()),
    (93219, 92020, 93210, '00980109', 'api'::sys_api_node_type, '工作流平台更新',     'PUT',    '/api/v1/ai-reports/workflow-platforms/{id:[0-9]+}', 9, 1, NOW(), NOW()),
    (93220, 92020, 93210, '00980110', 'api'::sys_api_node_type, '报告定义列表',       'GET',    '/api/v1/ai-reports/defs',                         10, 1, NOW(), NOW()),
    (93221, 92020, 93210, '00980111', 'api'::sys_api_node_type, '报告定义详情',       'GET',    '/api/v1/ai-reports/defs/{id:[0-9]+}',             11, 1, NOW(), NOW()),
    (93222, 92020, 93210, '00980112', 'api'::sys_api_node_type, '报告定义新建',       'POST',   '/api/v1/ai-reports/defs',                         12, 1, NOW(), NOW()),
    (93223, 92020, 93210, '00980113', 'api'::sys_api_node_type, '报告定义更新',       'PUT',    '/api/v1/ai-reports/defs/{id:[0-9]+}',             13, 1, NOW(), NOW()),
    (93224, 92020, 93210, '00980114', 'api'::sys_api_node_type, '报告定义删除',       'DELETE', '/api/v1/ai-reports/defs/{id:[0-9]+}',             14, 1, NOW(), NOW()),
    (93225, 92020, 93210, '00980115', 'api'::sys_api_node_type, '报告ACL列表',        'GET',    '/api/v1/ai-reports/acls',                         15, 1, NOW(), NOW()),
    (93226, 92020, 93210, '00980116', 'api'::sys_api_node_type, '报告ACL新建',        'POST',   '/api/v1/ai-reports/acls',                         16, 1, NOW(), NOW()),
    (93227, 92020, 93210, '00980117', 'api'::sys_api_node_type, '报告ACL删除',        'DELETE', '/api/v1/ai-reports/acls/{id:[0-9]+}',             17, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api a WHERE a.id = v.id)
  AND NOT EXISTS (
    SELECT 1 FROM sys_api a
    WHERE a.type = 'api' AND a.status = 1
      AND a.http_method = v.http_method
      AND a.path_pattern = v.path_pattern
  )
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 93210);

-- view
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (93240, 93201, 93211, 1, NOW()),
    (93241, 93201, 93212, 2, NOW()),
    (93242, 93201, 93216, 3, NOW()),
    (93243, 93201, 93217, 4, NOW()),
    (93244, 93201, 93220, 5, NOW()),
    (93245, 93201, 93221, 6, NOW()),
    (93246, 93201, 93225, 7, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = v.menu_id)
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = v.api_id);

-- save
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (93250, 93202, 93213, 1, NOW()),
    (93251, 93202, 93214, 2, NOW()),
    (93252, 93202, 93215, 3, NOW()),
    (93253, 93202, 93218, 4, NOW()),
    (93254, 93202, 93219, 5, NOW()),
    (93255, 93202, 93222, 6, NOW()),
    (93256, 93202, 93223, 7, NOW()),
    (93257, 93202, 93224, 8, NOW()),
    (93258, 93202, 93226, 9, NOW()),
    (93259, 93202, 93227, 10, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = v.menu_id)
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = v.api_id);

-- ===========================================================================
-- 3) 参数来源种子
-- ===========================================================================
INSERT INTO ai_param_source (
    id, source_code, name, value_type, wire_key, handler_bean, config_json, enabled, sort_order, created_at, updated_at
)
SELECT v.* FROM (VALUES
    (10001, 'auth_store', '权限门店', 'store', 'storeId', 'AuthStoreSourceHandler',
        '{"default":"first_authorized"}'::jsonb, 1::smallint, 10, NOW(), NOW()),
    (10002, 'cal_biz_date', '经营日', 'biz_date', 'bizDate', 'CalBizDateSourceHandler',
        '{"lookback_days":90}'::jsonb, 1::smallint, 20, NOW(), NOW()),
    (10003, 'cal_ord_week', '经营周', 'ord_week', 'ordWeek', 'CalOrdWeekSourceHandler',
        '{"lookback_weeks":26}'::jsonb, 1::smallint, 30, NOW(), NOW()),
    (10004, 'cal_ord_month', '经营月', 'ord_month', 'ordMonth', 'CalOrdMonthSourceHandler',
        '{"lookback_months":18}'::jsonb, 1::smallint, 40, NOW(), NOW())
) AS v(id, source_code, name, value_type, wire_key, handler_bean, config_json, enabled, sort_order, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM ai_param_source s WHERE s.id = v.id OR s.source_code = v.source_code);

-- ===========================================================================
-- 4) 工作流平台占位 + 分组分类 + 样例报告 + ACL
-- ===========================================================================
INSERT INTO ai_workflow_platform (id, platform_code, name, config_json, enabled, created_at, updated_at)
SELECT 10010, 'default-ai-wf', '默认 AI 工作流平台', NULL, 1, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM ai_workflow_platform WHERE id = 10010 OR platform_code = 'default-ai-wf');

INSERT INTO ai_report_category (id, parent_id, code, name, is_group, sort_order, enabled, created_by, created_at, updated_at)
SELECT v.* FROM (VALUES
    (10020, 0::bigint, 'spm', '超市经营', 1::smallint, 10, 1::smallint, NULL::bigint, NOW(), NOW()),
    (10021, 10020, 'spm-store', '门店报表', 0::smallint, 10, 1::smallint, NULL::bigint, NOW(), NOW())
) AS v(id, parent_id, code, name, is_group, sort_order, enabled, created_by, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM ai_report_category c WHERE c.id = v.id OR c.code = v.code);

INSERT INTO ai_report_def (
    id, report_code, title, description, category_id, slots_json,
    use_ai_workflow, workflow_platform_code, workflow_code,
    enabled, sort_order, created_by, created_at, updated_at
)
SELECT v.* FROM (VALUES
    (10030, 'RPT_DAILY', '门店经营日报', '门店 + 经营日', 10021,
        '[{"source_code":"auth_store","required":true},{"source_code":"cal_biz_date","required":true}]'::jsonb,
        0::smallint, NULL::varchar, NULL::varchar, 1::smallint, 10, NULL::bigint, NOW(), NOW()),
    (10031, 'RPT_WEEKLY', '门店经营周报', '门店 + 经营周', 10021,
        '[{"source_code":"auth_store","required":true},{"source_code":"cal_ord_week","required":true}]'::jsonb,
        0::smallint, NULL::varchar, NULL::varchar, 1::smallint, 20, NULL::bigint, NOW(), NOW())
) AS v(id, report_code, title, description, category_id, slots_json,
       use_ai_workflow, workflow_platform_code, workflow_code,
       enabled, sort_order, created_by, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM ai_report_def d WHERE d.id = v.id OR d.report_code = v.report_code);

-- ACL：角色 1 可访问两份样例（S3 prepare 将校验）
INSERT INTO ai_report_acl (id, report_code, subject_type, subject_id, created_at)
SELECT v.* FROM (VALUES
    (10040, 'RPT_DAILY', 'ROLE', '1', NOW()),
    (10041, 'RPT_WEEKLY', 'ROLE', '1', NOW())
) AS v(id, report_code, subject_type, subject_id, created_at)
WHERE NOT EXISTS (SELECT 1 FROM ai_report_acl a WHERE a.id = v.id)
  AND NOT EXISTS (
    SELECT 1 FROM ai_report_acl a
    WHERE a.report_code = v.report_code AND a.subject_type = v.subject_type AND a.subject_id = v.subject_id
  );
