-- ===========================================================================
-- V100__iqd_connection_delete_seed.sql —— 建模台「删除连接」端点登记
-- PostgreSQL 16 | 库名: mis_platform
-- 前置：V99（ask 绑定 test:use）；V96 已登记 GET/POST/PUT connections（92820+）。
--
-- 内容（1 条 sys_api + 1 条 sys_menu_api）：
--   DELETE /api/v1/iqd/connections/{id}  → iqd:modeling:edit（与 POST/PUT 同权限码）
--
-- 段位：sys_api 92900 / sys_menu_api 92901 / code 00960070 → 菜单 92632
-- 列口径对齐 V92：sys_menu_api 为 (id, menu_id, api_id, sort, created_at)，无 status 列。
-- ===========================================================================

INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.id, v.module_id, v.parent_id, v.code, v.type, v.name, v.http_method, v.path_pattern, v.sort, v.status, v.created_at, v.updated_at
FROM (
    VALUES
    (92900, 92020, 92550, '00960070', 'api'::sys_api_node_type, '建模台-删除连接', 'DELETE', '/api/v1/iqd/connections/{id}', 70, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api a WHERE a.id = v.id)
  AND NOT EXISTS (
    SELECT 1 FROM sys_api a
    WHERE a.type = 'api' AND a.status = 1
      AND a.http_method = v.http_method
      AND a.path_pattern = v.path_pattern
  );

INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (92901, 92632, 92900, 1, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (
    SELECT 1 FROM sys_menu_api ma WHERE ma.menu_id = v.menu_id AND ma.api_id = v.api_id
  )
  AND EXISTS (SELECT 1 FROM sys_menu m WHERE m.id = v.menu_id AND m.status = 1)
  AND EXISTS (SELECT 1 FROM sys_api a WHERE a.id = v.api_id);
