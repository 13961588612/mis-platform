-- V143__task_cc_api.sql
-- 门户「抄送我的」端点登记 + 绑定「我的待办」菜单 | PostgreSQL 16 | 幂等
--
-- ## 背景
--   BFF 新增 `GET /api/v1/tasks/cc`（仅 taskType=CC，与待办/已办隔离）。
--   `deny-unmapped:true` 要求登记 sys_api 并绑定启用菜单，否则 403。
--
-- ## ID 段位（V142 占用 95101，本文件取 95102）
--   sys_api 95102 / sys_menu_api 95102
--
-- ## 绑定菜单 = 95002「我的待办」（authOnly，登录即可；与 /tasks/my 同菜单）
--
-- ⚠️ 只追加；绝不修改 V1~V142。

INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
  (95102, 95010, 95010, 'task_cc_list', 'api'::sys_api_node_type, '抄送我的', 'GET', '/api/v1/tasks/cc', 102, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api a WHERE a.module_id = 95010 AND a.code = v.code)
  AND NOT EXISTS (
    SELECT 1 FROM sys_api a
    WHERE a.type = 'api' AND a.status = 1
      AND a.http_method = v.http_method AND a.path_pattern = v.path_pattern
  );

INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
  (95102, 95002, 95102, 1, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu_api ma WHERE ma.menu_id = v.menu_id AND ma.api_id = v.api_id)
  AND EXISTS (SELECT 1 FROM sys_menu m WHERE m.id = v.menu_id AND m.status = 1)
  AND EXISTS (SELECT 1 FROM sys_api a WHERE a.id = v.api_id);
