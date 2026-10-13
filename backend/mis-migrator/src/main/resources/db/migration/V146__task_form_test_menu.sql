-- V146__task_form_test_menu.sql
-- 工作台「测试表单」联调菜单 + 绑定发起/定义/表单只读 API | PostgreSQL 16 | 幂等
--
-- ## 背景
--   联调页路径 /task/form-test：选表单+已发布流程 → 填单 → 确认标题/过期/紧急 → 发起。
--   复用既有 sys_api：95034 启动流程、95030/95031 定义列表/详情、95052 表单列表。
--
-- ## ID
--   sys_menu 95110；sys_menu_api 95110~95113；sys_role_permission 951110
--
-- ⚠️ 只追加；绝不修改 V1~V145。

INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
  (95110, 1, 1, 95001, 'taskflow-form-test', '测试表单', 2, '/task/form-test', NULL, 'taskflow:form-test:use', 'FlaskConical', 5, 1, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu WHERE app_id = 1 AND code = v.code);

INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
  (95110, 95110, 95034, 1, NOW()),  -- POST /workflow/instances/start
  (95111, 95110, 95030, 2, NOW()),  -- GET  /workflow/definitions
  (95112, 95110, 95031, 3, NOW()),  -- GET  /workflow/definitions/{id}
  (95113, 95110, 95052, 4, NOW())   -- GET  /form-definitions
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu_api ma WHERE ma.menu_id = v.menu_id AND ma.api_id = v.api_id)
  AND EXISTS (SELECT 1 FROM sys_menu m WHERE m.id = v.menu_id AND m.status = 1)
  AND EXISTS (SELECT 1 FROM sys_api a WHERE a.id = v.api_id);

INSERT INTO sys_role_permission (id, role_id, perm_type, target_id, created_at)
SELECT 951110, 1, 'menu'::sys_perm_type, 95110, NOW()
WHERE NOT EXISTS (SELECT 1 FROM sys_role_permission WHERE id = 951110)
  AND NOT EXISTS (
    SELECT 1 FROM sys_role_permission rp
     WHERE rp.role_id = 1 AND rp.perm_type = 'menu'::sys_perm_type AND rp.target_id = 95110
  )
  AND EXISTS (SELECT 1 FROM sys_menu m WHERE m.id = 95110 AND m.status = 1);
