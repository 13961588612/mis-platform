-- V142__workflow_supported_forms_api.sql
-- 流程定义「关联表单」独立端点登记 + 绑定「流程定义」菜单 | PostgreSQL 16 | 幂等
--
-- ## 背景
--   表单关联从编排弹窗拆到列表「关联表单」弹窗；BFF 新增
--   `PUT /api/v1/workflow/definitions/{id}/supported-forms`（草稿/已发布均可改白名单，
--   不触碰画布节点）。`deny-unmapped:true` 要求登记 sys_api 并绑定启用菜单。
--
-- ## ID 段位（实施前已核实：V141 占用 95100，本文件取 95101）
--   sys_api 95101 / sys_menu_api 95101
--
-- ## 绑定菜单 = 95006「流程定义」（permission = workflow:definition:edit）
--
-- ## 幂等策略（对齐 V141）
--   * sys_api：固定 id + NOT EXISTS(同 id) + NOT EXISTS(同 module_id+code)
--     + NOT EXISTS(同 type+status+method+path)
--   * sys_menu_api：固定 id + NOT EXISTS(同 id) + NOT EXISTS(menu_id,api_id)
--     + 外键目标前置 EXISTS（菜单启用 + api 存在）
--
-- ⚠️ 只追加；绝不修改 V1~V141。

-- ===========================================================================
-- 1) 端点登记 sys_api 95101
-- ===========================================================================
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
  (95101, 95010, 95010, 'wf_def_supported_forms', 'api'::sys_api_node_type, '更新流程关联表单',
   'PUT', '/api/v1/workflow/definitions/{id:[0-9]+}/supported-forms', 101, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api a WHERE a.module_id = 95010 AND a.code = v.code)
  AND NOT EXISTS (
    SELECT 1 FROM sys_api a
    WHERE a.type = 'api' AND a.status = 1
      AND a.http_method = v.http_method AND a.path_pattern = v.path_pattern
  );

-- ===========================================================================
-- 2) 绑定「流程定义」菜单 95006 ⇄ 95101
-- ===========================================================================
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
  (95101, 95006, 95101, 20, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu_api ma WHERE ma.menu_id = v.menu_id AND ma.api_id = v.api_id)
  AND EXISTS (SELECT 1 FROM sys_menu m WHERE m.id = v.menu_id AND m.status = 1)
  AND EXISTS (SELECT 1 FROM sys_api a WHERE a.id = v.api_id);

-- 自检（取消注释手动执行）：
-- SELECT id, module_id, code, http_method, path_pattern, status FROM sys_api WHERE id = 95101;
-- SELECT id, menu_id, api_id FROM sys_menu_api WHERE id = 95101;
