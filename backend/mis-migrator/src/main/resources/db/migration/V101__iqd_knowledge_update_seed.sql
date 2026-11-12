-- ===========================================================================
-- V101__iqd_knowledge_update_seed.sql —— 「知识/术语」编辑能力端点登记
-- PostgreSQL 16 | 库名: mis_platform
-- 前置：V74（知识/术语 GET 92581 / POST 92582 / DELETE 92583、import-s07 92584）。
--
-- 内容（1 条 sys_api + 1 条 sys_menu_api）：
--   PUT /api/v1/iqd/knowledge/{id}  → iqd:enhance:save（与 POST/DELETE 同权限码）
--
-- 段位：sys_api 92930 / sys_menu_api 92931 / code 00960080 → 菜单 92522
-- 列口径对齐 V92/V100：sys_menu_api 为 (id, menu_id, api_id, sort, created_at)，无 status 列。
--
-- ⚠️ 新 method+path 未登记时，BFF 在 deny-unmapped=true 下直接 40300「接口未授权映射」。
--    BFF 内存注册表启动加载 + 每 300s 定时重载；迁移后最多等 300s，或重启 mis-admin-bff。
-- ===========================================================================

INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.id, v.module_id, v.parent_id, v.code, v.type, v.name, v.http_method, v.path_pattern, v.sort, v.status, v.created_at, v.updated_at
FROM (
    VALUES
    (92930, 92020, 92550, '00960080', 'api'::sys_api_node_type, '知识/术语编辑', 'PUT', '/api/v1/iqd/knowledge/{id:[0-9]+}', 11, 1, NOW(), NOW())
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
    (92931, 92522, 92930, 1, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (
    SELECT 1 FROM sys_menu_api ma WHERE ma.menu_id = v.menu_id AND ma.api_id = v.api_id
  )
  AND EXISTS (SELECT 1 FROM sys_menu m WHERE m.id = v.menu_id AND m.status = 1)
  AND EXISTS (SELECT 1 FROM sys_api a WHERE a.id = v.api_id);

-- ---------------------------------------------------------------------------
-- 验证（期望各 1 行；permission = iqd:enhance:save）：
--   SELECT a.http_method, a.path_pattern, m.permission
--     FROM sys_api a
--     JOIN sys_menu_api ma ON ma.api_id = a.id
--     JOIN sys_menu m ON m.id = ma.menu_id
--    WHERE a.id = 92930;
-- ---------------------------------------------------------------------------
