-- ===========================================================================
-- V63__kb_document_chunk_image_api.sql
--   增量：「查看文档切分」分片图片代理端点登记
--   GET /api/v1/kb/libraries/{libraryId}/documents/{id}/chunk-images/{imageId}
--   权限沿用 kb:document:list（菜单 91034），不新增权限码。
--   前置：V62；Flyway 只追加。
-- ===========================================================================

INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (91300, 91020, 91170, '00900086', 'api'::sys_api_node_type, '查看文档切分图片', 'GET',
     '/api/v1/kb/libraries/{libraryId:[0-9]+}/documents/{id:[0-9]+}/chunk-images/{imageId}',
     58, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api WHERE module_id = v.module_id AND code = v.code)
  AND NOT EXISTS (SELECT 1 FROM sys_api a WHERE a.type='api' AND a.status=1
        AND a.http_method = v.http_method AND a.path_pattern = v.path_pattern)
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 91170);

INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (91301, 91034, 91300, 1, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE menu_id = v.menu_id AND api_id = v.api_id)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = 91034)
  AND EXISTS (SELECT 1 FROM sys_api  WHERE id = 91300);
