-- ===========================================================================
-- V158__iqd_model_delete_api_seed.sql —— 模型删除端点登记
-- PostgreSQL 16 | 库名: mis_platform
-- 前置：V87（建模台主页 92600 + 权限码 92632 iqd:modeling:edit）。
--
-- 内容（1 条 sys_api + 1 条 sys_menu_api）：
--   DELETE /api/v1/iqd/catalog/model/{itemKey} → iqd:modeling:edit（菜单 92632）
--
-- 语义：物理删除模型 + 对应物理表节点 + 列；级联清理范围策略 / 行级 ACL；
--   被关系 / Cube / sql_pair / knowledge 直接引用时 42200 + dependents（硬阻断）。
--
-- 段位：sys_api 92988 / sys_menu_api 92989 / code 00960124 → 菜单 92632
--   （92980-92987 被 V148 占用；code 00960123 已用 → 00960124）
-- ===========================================================================

INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.id, v.module_id, v.parent_id, v.code, v.type, v.name, v.http_method, v.path_pattern, v.sort, v.status, v.created_at, v.updated_at
FROM (
    VALUES
    (92988, 92020, 92550, '00960124', 'api'::sys_api_node_type, '建模台-删除模型', 'DELETE', '/api/v1/iqd/catalog/model/{itemKey}', 40, 1, NOW(), NOW())
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
    (92989, 92632, 92988, 1, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (
    SELECT 1 FROM sys_menu_api ma WHERE ma.menu_id = v.menu_id AND ma.api_id = v.api_id
  )
  AND EXISTS (SELECT 1 FROM sys_menu m WHERE m.id = v.menu_id AND m.status = 1)
  AND EXISTS (SELECT 1 FROM sys_api a WHERE a.id = v.api_id);

-- ---------------------------------------------------------------------------
-- 验证（期望 1 行；permission = iqd:modeling:edit）：
--   SELECT a.http_method, a.path_pattern, m.permission
--     FROM sys_api a
--     JOIN sys_menu_api ma ON ma.api_id = a.id
--     JOIN sys_menu m ON m.id = ma.menu_id
--    WHERE a.id = 92988;
-- ---------------------------------------------------------------------------
