-- ===========================================================================
-- V65__kb_document_chunk_image_api_path_fix.sql
--   补偿 V63/V64 静默失败：module 91020 下 code=00900086 已被管理台误登记为
--   GET /api/v1/kb/documents/images/{imageId}（id=1787044749822），且挂到问答菜单
--   91036（kb:qa:ask）。V63/V64 的 NOT EXISTS(module_id+code) 守卫导致正确 path
--   /api/v1/kb/libraries/{libraryId}/documents/{id}/chunk-images/{imageId} 从未入库
--   → BFF deny-unmapped → 40300「接口未授权映射」。
--
--   内容：
--   A. 修正误登记 sys_api 的 path_pattern / 父节点 / 名称
--   B. 删除误挂 menu_api（91036 问答菜单）
--   C. 绑定文档列表菜单 91034（kb:document:list）
--   D. 兜底：若环境无 chunk-images 登记，用 code 00900087 + id 91300 插入
--
--   前置：V64；Flyway 只追加。
-- ===========================================================================

-- A. 修正管理台误登记的 path（code 00900086 占用导致 V63/V64 跳过）
UPDATE sys_api
SET path_pattern = '/api/v1/kb/libraries/{libraryId:[0-9]+}/documents/{id:[0-9]+}/chunk-images/{imageId}',
    name         = '查看文档切分图片',
    parent_id    = 91170,
    http_method  = 'GET',
    sort         = 58,
    updated_at   = NOW()
WHERE module_id = 91020
  AND code = '00900086'
  AND path_pattern = '/api/v1/kb/documents/images/{imageId}';

-- B. 移除误挂到问答菜单(91036/kb:qa:ask)的绑定
DELETE FROM sys_menu_api
WHERE menu_id = 91036
  AND api_id IN (
      SELECT id FROM sys_api
      WHERE module_id = 91020
        AND path_pattern LIKE '%/chunk-images/{imageId}'
  );

-- C. 文档列表菜单(91034/kb:document:list) → 已修正的 chunk-images API
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (92178, 91034, 1787044749822, 1, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE EXISTS (
      SELECT 1 FROM sys_api
      WHERE id = 1787044749822
        AND path_pattern LIKE '%/chunk-images/{imageId}'
  )
  AND NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (
      SELECT 1 FROM sys_menu_api ma
      WHERE ma.menu_id = v.menu_id AND ma.api_id = v.api_id
  )
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = 91034);

-- D. 兜底：全新环境或无 id=1787044749822 时，用 00900087 插入标准登记
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (91300, 91020, 91170, '00900087', 'api'::sys_api_node_type, '查看文档切分图片', 'GET',
     '/api/v1/kb/libraries/{libraryId:[0-9]+}/documents/{id:[0-9]+}/chunk-images/{imageId}',
     58, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (
      SELECT 1 FROM sys_api a
      WHERE a.type = 'api' AND a.status = 1
        AND a.http_method = 'GET'
        AND a.path_pattern LIKE '%/chunk-images/{imageId}'
  )
  AND NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api WHERE module_id = v.module_id AND code = v.code)
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 91170);

INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (92179, 91034, 91300, 1, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE EXISTS (SELECT 1 FROM sys_api WHERE id = 91300)
  AND NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (
      SELECT 1 FROM sys_menu_api ma
      WHERE ma.menu_id = v.menu_id AND ma.api_id = v.api_id
  )
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = 91034);

-- ---------------------------------------------------------------------------
-- 迁移后自检
--
--   SELECT a.id, a.http_method, a.path_pattern, m.permission
--   FROM sys_api a
--   JOIN sys_menu_api ma ON ma.api_id = a.id
--   JOIN sys_menu m ON ma.menu_id = m.id
--   WHERE a.path_pattern LIKE '%chunk-images%';
--   -- 期望 1 行：GET .../chunk-images/{imageId}  kb:document:list
--
--   然后重启 mis-admin-bff（或等 refresh-interval-seconds 默认 300s）。
-- ---------------------------------------------------------------------------
