-- V152__message_manage_resolve_phones.sql
-- 消息管理：按手机号解析接收人 | PostgreSQL 16 | 幂等
-- sys_api 95148；sys_menu_api 95148（绑消息管理按钮 95131）

INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
  (95148, 95010, 95010, 'msg_manage_phones', 'api'::sys_api_node_type, '按手机号解析接收人', 'POST', '/api/v1/messages/manage/resolve-phones', 148, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api a WHERE a.module_id = 95010 AND a.code = v.code);

INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
  (95148, 95131, 95148, 8, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu_api ma WHERE ma.menu_id = v.menu_id AND ma.api_id = v.api_id)
  AND EXISTS (SELECT 1 FROM sys_menu m WHERE m.id = v.menu_id AND m.status = 1)
  AND EXISTS (SELECT 1 FROM sys_api a WHERE a.id = v.api_id);
