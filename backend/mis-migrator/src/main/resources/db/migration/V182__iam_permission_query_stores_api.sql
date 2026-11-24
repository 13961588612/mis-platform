-- ===========================================================================
-- V182__iam_permission_query_stores_api.sql
-- 身份权限模块：顶级「权限模块」→「权限查询」→「查询当前操作员权限内门店」
-- 路径：GET /api/v1/permissions/stores?storeType=（可选 BGMD/CSMD/WLZS）
-- 鉴权：挂菜单 90（认证，permission=NULL）→ authOnly，登录即可。
-- 段位：sys_api 1100-1102 / code 0007*；sys_menu_api 11020
-- ===========================================================================

INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (1100, 1, 0,    '0007',         'catalog'::sys_api_node_type, '权限模块', NULL::VARCHAR, NULL::VARCHAR, 7, 1, NOW(), NOW()),
    (1101, 1, 1100, '00070001',     'catalog'::sys_api_node_type, '权限查询', NULL::VARCHAR, NULL::VARCHAR, 1, 1, NOW(), NOW()),
    (1102, 1, 1101, '000700010001', 'api'::sys_api_node_type,     '查询当前操作员权限内门店', 'GET', '/api/v1/permissions/stores', 1, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api WHERE module_id = v.module_id AND code = v.code)
  AND EXISTS (SELECT 1 FROM sys_module WHERE id = 1);

INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (11020, 90, 1102, 10, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE menu_id = v.menu_id AND api_id = v.api_id)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = 90)
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 1102);
