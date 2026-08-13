-- ===========================================================================
-- V42__kb_document_chunks_api.sql
--   增量：「查看文档切分效果」端点登记（BFF GET /api/v1/kb/libraries/{libraryId}/documents/{id}/chunks）
--   设计：知识库 · 文档管理页查看文档切分效果（方案 A：引擎直查 RAGFlow chunks 端点）
--   前置：V41 为当前最新版本；本文件为 V42，Flyway 只追加不修改已发布版本。
--
--   内容：
--   A. sys_api 登记查看文档切分端点（id=91200 / code=00900084 / parent=91170 文档域 catalog，
--      module 91020）。权限沿用既有 kb:document:list（菜单 91034），不新增权限码。
--   B. sys_menu_api 绑定（id=91289 / menu=91034 / api=91200）。
--
--   段位说明（V36 域重组后）：
--     parent_id=91170（文档域 catalog，V36 已把 /documents% 路径 reparent 到 91170；
--     勿用 V36 之前的 91060）；sort=57 在 91170 域内顺延 V32 的 91130/91131（sort 55/56）。
--     code=00900084 在 module 91020 内顺延 V41 的 00900083（uk_api_module_code 复合唯一）。
--
--   幂等：登记段 WHERE NOT EXISTS 三重去重（id / module_id+code / method+path）
--   + 父节点存在性校验；可重复执行。约束：不得修改已发布的 V1-V41。
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A. sys_api 登记：查看文档切分（GET /api/v1/kb/libraries/{libraryId}/documents/{id}/chunks）
--    父节点 91170（文档域 catalog）存在才落，避免孤儿登记。
-- ---------------------------------------------------------------------------
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (91200, 91020, 91170, '00900084', 'api'::sys_api_node_type, '查看文档切分', 'GET', '/api/v1/kb/libraries/{libraryId:[0-9]+}/documents/{id:[0-9]+}/chunks', 57, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api WHERE module_id = v.module_id AND code = v.code)
  AND NOT EXISTS (SELECT 1 FROM sys_api a WHERE a.type='api' AND a.status=1
        AND a.http_method = v.http_method AND a.path_pattern = v.path_pattern)
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 91170);

-- ---------------------------------------------------------------------------
-- B. sys_menu_api 绑定：菜单 91034（文档页，权限 kb:document:list）→ API 91200
--    注意：绑定 id 必须是 91289（91288 已被 V41 占用，误写会被 NOT EXISTS(id) 静默跳过）。
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (91289, 91034, 91200, 1, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE menu_id = v.menu_id AND api_id = v.api_id)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = 91034)
  AND EXISTS (SELECT 1 FROM sys_api  WHERE id = 91200);
