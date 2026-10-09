-- V123__taskflow_menu_api_seed.sql
-- 任务流（消息/代办/工作流/审计/执行监控）菜单 + sys_api + 菜单绑定 + 内置管理员授权
-- PostgreSQL 16 | 幂等：固定 ID + WHERE NOT EXISTS / ON CONFLICT
-- 段位（已 grep V1-V122 + 实测库核实）：sys_menu 95001-95010 空闲；sys_api 95020-95044 空闲；
--   sys_module 95010 空闲（现有最大 94020）；sys_api module_id=95010；app_id=1（系统管理）。

-- ---------------------------------------------------------------------------
-- 0) 模块登记：任务流
-- ---------------------------------------------------------------------------
INSERT INTO sys_module (id, code, name, service_name, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
  (95010, 'taskflow', '任务流模块', 'mis-taskflow', 6, 1, NOW(), NOW())
) AS v(id, code, name, service_name, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_module WHERE id = 95010)
  AND NOT EXISTS (SELECT 1 FROM sys_module WHERE code = 'taskflow')
  AND NOT EXISTS (SELECT 1 FROM sys_module WHERE service_name = 'mis-taskflow');

-- ---------------------------------------------------------------------------
-- 1) 工作台（流程维度）根目录 + 四个入口
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
  (95001, 1, 1, 0, 'taskflow-workbench', '工作台', 1, '/task', NULL, NULL, 'ClipboardList', 5, 1, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = 95001)
  AND NOT EXISTS (SELECT 1 FROM sys_menu WHERE app_id = 1 AND code = 'taskflow-workbench');

INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
  (95002, 1, 1, 95001, 'taskflow-pending',     '我的待办',   2, '/task/pending',      NULL, 'taskflow:task:list',   'ClipboardList',  1, 1, 1, NOW(), NOW()),
  (95003, 1, 1, 95001, 'taskflow-inbox',       '消息与待办', 2, '/task/inbox',        NULL, 'taskflow:message:view','MessagesSquare', 2, 1, 1, NOW(), NOW()),
  (95004, 1, 1, 95001, 'taskflow-my-sent',     '我发起的',   2, '/task/my-sent',      NULL, 'taskflow:process:view','History',        3, 1, 1, NOW(), NOW()),
  (95005, 1, 1, 95001, 'taskflow-my-processed','我审批的',   2, '/task/my-processed', NULL, 'taskflow:task:handled','ClipboardCheck', 4, 1, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu WHERE app_id = 1 AND code = v.code);

-- ---------------------------------------------------------------------------
-- 2) 流程中心（管理维度）挂在「系统管理」(200) 下
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
  (95006, 1, 1, 200, 'workflow-definitions', '流程定义', 2, '/system/workflow/definitions', NULL, 'workflow:definition:view',  'GitBranch', 20, 1, 1, NOW(), NOW()),
  (95007, 1, 1, 200, 'workflow-designer',    '流程编排', 2, '/system/workflow/designer',    NULL, 'workflow:definition:edit',  'Workflow',  21, 1, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu WHERE app_id = 1 AND code = v.code);

-- ---------------------------------------------------------------------------
-- 3) 审计与执行监控挂在「系统监控」(300) 下
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
  (95008, 1, 1, 300, 'system-audit-op',    '业务审计', 2, '/system/audit-op',    NULL, 'taskflow:audit:view', 'ClipboardCheck', 10, 1, 1, NOW(), NOW()),
  (95009, 1, 1, 300, 'system-exec-monitor','执行监控', 2, '/system/exec-monitor',NULL, 'taskflow:exec:manage','Activity',       11, 1, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu WHERE app_id = 1 AND code = v.code);

-- ---------------------------------------------------------------------------
-- 4) sys_api 登记（module=95010；parent=95010 catalog）
-- ---------------------------------------------------------------------------
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
  (95010, 95010, 0, '00950001', 'catalog'::sys_api_node_type, '任务流 API', NULL, NULL, 1, 1, NOW(), NOW()),
  (95020, 95010, 95010, '00950010', 'api'::sys_api_node_type, '收件箱列表', 'GET', '/api/v1/messages/inbox', 10, 1, NOW(), NOW()),
  (95021, 95010, 95010, '00950011', 'api'::sys_api_node_type, '消息检索',   'GET', '/api/v1/messages/search', 11, 1, NOW(), NOW()),
  (95022, 95010, 95010, '00950012', 'api'::sys_api_node_type, '消息详情',   'GET', '/api/v1/messages/{id:[0-9]+}', 12, 1, NOW(), NOW()),
  (95023, 95010, 95010, '00950013', 'api'::sys_api_node_type, '标记已读',   'POST', '/api/v1/messages/read', 13, 1, NOW(), NOW()),
  (95024, 95010, 95010, '00950014', 'api'::sys_api_node_type, '消息统计',   'GET', '/api/v1/messages/stats', 14, 1, NOW(), NOW()),
  (95025, 95010, 95010, '00950020', 'api'::sys_api_node_type, '我的待办',   'GET', '/api/v1/tasks/my', 20, 1, NOW(), NOW()),
  (95026, 95010, 95010, '00950021', 'api'::sys_api_node_type, '待办统计',   'GET', '/api/v1/tasks/stats', 21, 1, NOW(), NOW()),
  (95027, 95010, 95010, '00950022', 'api'::sys_api_node_type, '处理待办',   'POST', '/api/v1/tasks/{id:[0-9]+}/handle', 22, 1, NOW(), NOW()),
  (95028, 95010, 95010, '00950023', 'api'::sys_api_node_type, '转办待办',   'POST', '/api/v1/tasks/{id:[0-9]+}/transfer', 23, 1, NOW(), NOW()),
  (95029, 95010, 95010, '00950024', 'api'::sys_api_node_type, '批量处理',   'POST', '/api/v1/tasks/batch-handle', 24, 1, NOW(), NOW()),
  (95030, 95010, 95010, '00950030', 'api'::sys_api_node_type, '流程定义列表','GET', '/api/v1/workflow/definitions', 30, 1, NOW(), NOW()),
  (95031, 95010, 95010, '00950031', 'api'::sys_api_node_type, '流程定义详情','GET', '/api/v1/workflow/definitions/{id:[0-9]+}', 31, 1, NOW(), NOW()),
  (95032, 95010, 95010, '00950032', 'api'::sys_api_node_type, '保存流程定义','POST','/api/v1/workflow/definitions', 32, 1, NOW(), NOW()),
  (95033, 95010, 95010, '00950033', 'api'::sys_api_node_type, '发布流程定义','POST','/api/v1/workflow/definitions/{id:[0-9]+}/activate', 33, 1, NOW(), NOW()),
  (95034, 95010, 95010, '00950034', 'api'::sys_api_node_type, '启动流程',   'POST', '/api/v1/workflow/instances/start', 34, 1, NOW(), NOW()),
  (95035, 95010, 95010, '00950035', 'api'::sys_api_node_type, '流程实例详情','GET', '/api/v1/workflow/instances/{id:[0-9]+}', 35, 1, NOW(), NOW()),
  (95036, 95010, 95010, '00950036', 'api'::sys_api_node_type, '我发起的流程','GET', '/api/v1/workflow/instances/my', 36, 1, NOW(), NOW()),
  (95037, 95010, 95010, '00950037', 'api'::sys_api_node_type, '处理流程任务','POST','/api/v1/workflow/tasks/{id:[0-9]+}/complete', 37, 1, NOW(), NOW()),
  (95040, 95010, 95010, '00950040', 'api'::sys_api_node_type, '业务审计列表','GET', '/api/v1/audit-ops', 40, 1, NOW(), NOW()),
  (95041, 95010, 95010, '00950041', 'api'::sys_api_node_type, '业务审计详情','GET', '/api/v1/audit-ops/{id:[0-9]+}', 41, 1, NOW(), NOW()),
  (95042, 95010, 95010, '00950042', 'api'::sys_api_node_type, '业务审计时间线','GET','/api/v1/audit-ops/timeline/{businessType}/{businessId}', 42, 1, NOW(), NOW()),
  (95043, 95010, 95010, '00950043', 'api'::sys_api_node_type, '执行监控列表','GET', '/api/v1/exec-monitor', 43, 1, NOW(), NOW()),
  (95044, 95010, 95010, '00950044', 'api'::sys_api_node_type, '强制归档',   'POST','/api/v1/exec-monitor/{id:[0-9]+}/force-archive', 44, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api a WHERE a.module_id = 95010 AND a.code = v.code)
  AND NOT EXISTS (
    SELECT 1 FROM sys_api a
    WHERE a.type = 'api' AND a.status = 1
      AND a.http_method = v.http_method
      AND a.path_pattern = v.path_pattern
  );

-- ---------------------------------------------------------------------------
-- 5) 菜单 ⇄ API 绑定
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
  (95020, 95003, 95020, 1, NOW()), (95021, 95003, 95021, 2, NOW()), (95022, 95003, 95022, 3, NOW()),
  (95023, 95003, 95023, 4, NOW()), (95024, 95003, 95024, 5, NOW()),
  (95025, 95002, 95025, 1, NOW()), (95026, 95002, 95026, 2, NOW()), (95027, 95002, 95027, 3, NOW()),
  (95028, 95002, 95028, 4, NOW()), (95029, 95002, 95029, 5, NOW()),
  (95030, 95006, 95030, 1, NOW()), (95031, 95006, 95031, 2, NOW()), (95032, 95007, 95032, 1, NOW()),
  (95033, 95007, 95033, 2, NOW()), (95034, 95004, 95034, 1, NOW()), (95035, 95004, 95035, 2, NOW()),
  (95036, 95004, 95036, 3, NOW()), (95037, 95002, 95037, 6, NOW()), (95040, 95008, 95040, 1, NOW()),
  (95041, 95008, 95041, 2, NOW()), (95042, 95008, 95042, 3, NOW()), (95043, 95009, 95043, 1, NOW()),
  (95044, 95009, 95044, 2, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu_api ma WHERE ma.menu_id = v.menu_id AND ma.api_id = v.api_id)
  AND EXISTS (SELECT 1 FROM sys_menu m WHERE m.id = v.menu_id AND m.status = 1)
  AND EXISTS (SELECT 1 FROM sys_api a WHERE a.id = v.api_id);

-- ---------------------------------------------------------------------------
-- 6) 内置租户管理员（role_id=1）菜单授权
-- ---------------------------------------------------------------------------
INSERT INTO sys_role_permission (id, role_id, perm_type, target_id, created_at)
SELECT v.* FROM (VALUES
  (95001, 1, 'menu'::sys_perm_type, 95001, NOW()),
  (95002, 1, 'menu'::sys_perm_type, 95002, NOW()),
  (95003, 1, 'menu'::sys_perm_type, 95003, NOW()),
  (95004, 1, 'menu'::sys_perm_type, 95004, NOW()),
  (95005, 1, 'menu'::sys_perm_type, 95005, NOW()),
  (95006, 1, 'menu'::sys_perm_type, 95006, NOW()),
  (95007, 1, 'menu'::sys_perm_type, 95007, NOW()),
  (95008, 1, 'menu'::sys_perm_type, 95008, NOW()),
  (95009, 1, 'menu'::sys_perm_type, 95009, NOW())
) AS v(id, role_id, perm_type, target_id, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_role_permission WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_role_permission rp WHERE rp.role_id = v.role_id AND rp.perm_type = v.perm_type AND rp.target_id = v.target_id)
  AND EXISTS (SELECT 1 FROM sys_role WHERE id = v.role_id);

-- ---------------------------------------------------------------------------
-- 7) 演示流程定义（采购审批：START → 主管审批 → END；表单白名单 PUR_FORM）
--    幂等：code+version 唯一。定义与节点用固定 ID。
-- ---------------------------------------------------------------------------
INSERT INTO wf_definition (id, tenant_id, code, name, category, description, version, status, supported_form_codes, config, deleted, created_by, created_at, updated_at)
SELECT v.* FROM (VALUES
  (950001, 1, 'PURCHASE_APPROVAL_DEMO', '采购审批（示例）', 'APPROVAL',
   '演示用单级审批流程，登记人提交后由固定审批人处理', 1, 'ACTIVE',
   ARRAY['PUR_FORM']::text[], '{}'::jsonb, 0, 1, NOW(), NOW())
) AS v(id, tenant_id, code, name, category, description, version, status, supported_form_codes, config, deleted, created_by, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM wf_definition WHERE code = 'PURCHASE_APPROVAL_DEMO' AND version = 1);

INSERT INTO wf_node (id, definition_id, node_code, node_name, node_type, sort_order, condition_expr, assignee_rule, timeout_hours, config, created_at)
SELECT v.* FROM (VALUES
  (950011, 950001, 'start',   '提交申请', 'START', 0, NULL, '{}'::jsonb, NULL, '{}'::jsonb, NOW()),
  (950012, 950001, 'approve', '主管审批', 'APPROVAL', 1, NULL, '{"type":"SELF"}'::jsonb, 24, '{}'::jsonb, NOW()),
  (950013, 950001, 'end',     '归档',     'END', 2, NULL, '{}'::jsonb, NULL, '{}'::jsonb, NOW())
) AS v(id, definition_id, node_code, node_name, node_type, sort_order, condition_expr, assignee_rule, timeout_hours, config, created_at)
WHERE NOT EXISTS (SELECT 1 FROM wf_node WHERE id = v.id)
  AND EXISTS (SELECT 1 FROM wf_definition WHERE id = 950001);

-- 自检（取消注释手动执行）：
-- SELECT id, code, name, path, permission FROM sys_menu WHERE id BETWEEN 95001 AND 95009 ORDER BY id;
-- SELECT id, code, name, http_method, path_pattern FROM sys_api WHERE module_id = 95010 ORDER BY id;
-- SELECT id, code, name, supported_form_codes FROM wf_definition WHERE code = 'PURCHASE_APPROVAL_DEMO';