-- ===========================================================================
-- V112__iqd_scope_policy_delete_api_seed.sql — 范围策略删除端点登记
-- PostgreSQL 16 | 库名: mis_platform
-- 前置：V73（范围策略 GET/POST 92563/92564 → iqd:scope:view/save；菜单 92511/92512）
--
-- 背景：范围策略编辑（取消勾选对象/字段）需要删除能力，否则孤儿行残留。
-- 新增 1 条 sys_api + 1 条 sys_menu_api：
--   DELETE /api/v1/iqd/scope/policies/{id} → iqd:scope:save（与范围策略保存同权限码）
--   POST   /api/v1/iqd/scope/policies/delete-batch → iqd:scope:save（编辑时删除取消勾选的字段行）
--
-- 段位：sys_api 92946-92947（V109 用了 92940-92945）；sys_menu_api 92966-92967（V109 用了 92960-92965）；
--   code 段 00960105 已用 → 00960106 / 00960107。
-- 列口径对齐 V92/V109：sys_menu_api 为 (id, menu_id, api_id, sort, created_at)，无 status 列。
--
-- ⚠️ 新 method+path 未登记时，BFF 在 deny-unmapped=true 下直接 40300「接口未授权映射」。
-- ===========================================================================

INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.id, v.module_id, v.parent_id, v.code, v.type, v.name, v.http_method, v.path_pattern, v.sort, v.status, v.created_at, v.updated_at
FROM (
    VALUES
    (92946, 92020, 92550, '00960106', 'api'::sys_api_node_type, '范围策略删除', 'DELETE', '/api/v1/iqd/scope/policies/{id:[0-9]+}', 16, 1, NOW(), NOW()),
    (92947, 92020, 92550, '00960107', 'api'::sys_api_node_type, '范围策略批量删除', 'POST', '/api/v1/iqd/scope/policies/delete-batch', 17, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api a WHERE a.id = v.id)
  AND NOT EXISTS (
    SELECT 1 FROM sys_api a
    WHERE a.type = 'api' AND a.status = 1
      AND a.http_method = v.http_method
      AND a.path_pattern = v.path_pattern
  )
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 92550);

INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (92966, 92512, 92946, 1, NOW()),
    (92967, 92512, 92947, 1, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (
    SELECT 1 FROM sys_menu_api ma WHERE ma.menu_id = v.menu_id AND ma.api_id = v.api_id
  )
  AND EXISTS (SELECT 1 FROM sys_menu m WHERE m.id = v.menu_id AND m.status = 1)
  AND EXISTS (SELECT 1 FROM sys_api a WHERE a.id = v.api_id);

-- ---------------------------------------------------------------------------
-- 验证：应 2 行，permission = iqd:scope:save：
--   SELECT a.http_method, a.path_pattern, m.permission
--     FROM sys_api a
--     JOIN sys_menu_api ma ON ma.api_id = a.id
--     JOIN sys_menu m ON m.id = ma.menu_id
--    WHERE a.id IN (92946, 92947);
-- ---------------------------------------------------------------------------
