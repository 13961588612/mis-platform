-- ===========================================================================
-- V67__kb_chunk_image_derived_resource_perms.sql
--   附属资源（chunk-images）统一授权：可读门槛 = 能让该内容出现的入口权限并集。
--
--   背景：
--   - deny-unmapped=true 下 GET .../chunk-images/{imageId} 未命中注册表 → 40300
--   - V63–V65 仅尝试挂 kb:document:list；问答 / Agent 本地对话出图仍会缺映射或语义错位
--   - 本迁移不写死业务特例名单，按「附属资源」规则补齐 path + 多菜单绑定
--
--   内容：
--   A. 纠正错误 / 无正则约束的 path_pattern（与 Controller 一致）
--   B. 兜底插入标准 sys_api（若环境仍无 chunk-images 行）
--   C. 同一 api 挂 91034 / 91036 / 92032（document:list ∪ qa:ask ∪ agent:chat:use）
--
--   前置：V66；Flyway 只追加。
-- ===========================================================================

-- A. 纠正 path（仅当目标正确 path 尚不存在，避免撞 uk_api_method_path）
UPDATE sys_api
SET path_pattern = '/api/v1/kb/libraries/{libraryId:[0-9]+}/documents/{id:[0-9]+}/chunk-images/{imageId}',
    name         = '查看文档切分图片',
    parent_id    = COALESCE(parent_id, 91170),
    http_method  = 'GET',
    updated_at   = NOW()
WHERE type = 'api'
  AND status = 1
  AND http_method = 'GET'
  AND (
      path_pattern = '/api/v1/kb/documents/images/{imageId}'
      OR path_pattern = '/api/v1/kb/libraries/{libraryId}/documents/{id}/chunk-images/{imageId}'
  )
  AND NOT EXISTS (
      SELECT 1 FROM sys_api a2
      WHERE a2.type = 'api' AND a2.status = 1 AND a2.http_method = 'GET'
        AND a2.path_pattern = '/api/v1/kb/libraries/{libraryId:[0-9]+}/documents/{id:[0-9]+}/chunk-images/{imageId}'
  );

-- B. 兜底：环境仍无标准 path 时插入（code 00900088，避开 V63/V65 的 00900086/87）
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (91305, 91020, 91170, '00900088', 'api'::sys_api_node_type, '查看文档切分图片', 'GET',
     '/api/v1/kb/libraries/{libraryId:[0-9]+}/documents/{id:[0-9]+}/chunk-images/{imageId}',
     58, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (
      SELECT 1 FROM sys_api a
      WHERE a.type = 'api' AND a.status = 1 AND a.http_method = 'GET'
        AND a.path_pattern = '/api/v1/kb/libraries/{libraryId:[0-9]+}/documents/{id:[0-9]+}/chunk-images/{imageId}'
  )
  AND NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api WHERE module_id = v.module_id AND code = v.code)
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 91170);

-- C. 附属资源并集绑定：文档列表 / 智能问答 / Agent 本地对话
--    sys_menu_api 92180–92182（V65 用到 92178–92179）
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.id, v.menu_id, a.api_id, v.sort, NOW()
FROM (VALUES
    (92180::bigint, 91034::bigint, 1),  -- kb:document:list
    (92181::bigint, 91036::bigint, 2),  -- kb:qa:ask
    (92182::bigint, 92032::bigint, 3)   -- agent:chat:use
) AS v(id, menu_id, sort)
CROSS JOIN LATERAL (
    SELECT id AS api_id
    FROM sys_api
    WHERE type = 'api' AND status = 1 AND http_method = 'GET'
      AND path_pattern = '/api/v1/kb/libraries/{libraryId:[0-9]+}/documents/{id:[0-9]+}/chunk-images/{imageId}'
    ORDER BY id
    LIMIT 1
) a
WHERE EXISTS (SELECT 1 FROM sys_menu WHERE id = v.menu_id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (
      SELECT 1 FROM sys_menu_api ma
      WHERE ma.menu_id = v.menu_id AND ma.api_id = a.api_id
  );

-- ---------------------------------------------------------------------------
-- 迁移后自检
--
--   SELECT a.id, a.path_pattern, m.id AS menu_id, m.permission
--   FROM sys_api a
--   JOIN sys_menu_api ma ON ma.api_id = a.id
--   JOIN sys_menu m ON ma.menu_id = m.id
--   WHERE a.path_pattern LIKE '%/chunk-images/{imageId}'
--   ORDER BY m.id;
--   -- 期望 ≥3 行权限：kb:document:list / kb:qa:ask / agent:chat:use
--
--   然后重启 mis-admin-bff（或等 refresh-interval-seconds 默认 300s）。
-- ---------------------------------------------------------------------------
