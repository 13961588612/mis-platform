-- ===========================================================================
-- V64__kb_document_chunk_image_menu_api_fix.sql
--   补偿 V63：sys_menu_api.id=91301 已被 V59 占用，V63 绑定被 NOT EXISTS 静默跳过
--   → BFF findRegistryRows INNER JOIN 匹配不到 → deny-unmapped → 40300「接口未授权映射」。
--
--   GET /api/v1/kb/libraries/{libraryId}/documents/{id}/chunk-images/{imageId}
--   权限沿用 kb:document:list（菜单 91034）。
--
--   内容：
--   A. 幂等补登 sys_api 91300（V63 可能已成功，此处守卫）
--   B. sys_menu_api 91304 → menu 91034 + api 91300（新 id，避开 V59 的 91301）
--
--   前置：V63；Flyway 只追加。
-- ===========================================================================

INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (91300, 91020, 91170, '00900086', 'api'::sys_api_node_type, '查看文档切分图片', 'GET',
     '/api/v1/kb/libraries/{libraryId:[0-9]+}/documents/{id:[0-9]+}/chunk-images/{imageId}',
     58, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api WHERE module_id = v.module_id AND code = v.code)
  AND NOT EXISTS (SELECT 1 FROM sys_api a WHERE a.type = 'api' AND a.status = 1
        AND a.http_method = v.http_method AND a.path_pattern = v.path_pattern)
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 91170);

INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (91304, 91034, 91300, 1, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE menu_id = v.menu_id AND api_id = v.api_id)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = 91034)
  AND EXISTS (SELECT 1 FROM sys_api  WHERE id = 91300);

-- ---------------------------------------------------------------------------
-- 迁移后自检
--
--   SELECT a.id, a.http_method, a.path_pattern, m.permission
--   FROM sys_api a
--   JOIN sys_menu_api ma ON ma.api_id = a.id
--   JOIN sys_menu m ON ma.menu_id = m.id
--   WHERE a.id = 91300;
--   -- 期望 1 行：GET .../chunk-images/{imageId}  kb:document:list
--
--   BFF 重启或等待 api-permission.refresh-interval-seconds（默认 300s）重载注册表。
-- ---------------------------------------------------------------------------
