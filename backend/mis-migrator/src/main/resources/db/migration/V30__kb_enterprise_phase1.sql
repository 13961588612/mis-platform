-- ===========================================================================
-- V30__kb_enterprise_phase1.sql —— 知识库 RAG 设置企业级增强一期（T0 公共地基）
-- PostgreSQL 16 | 库名: mis_platform
-- 设计：docs/backend/mis-kb-enterprise-phase1-design-2026-08-11.md（施工唯一标准）
-- 前置：V29 为当前最新版本；本文件为 V30，Flyway 只追加不修改已发布版本。
--
-- 内容三段：
--   A. kb_document 解析治理列：parse_progress（0~100）/ parse_error（失败摘要 ≤500 字）
--   B. RagSettings 零 DDL：ocrEnabled/ocrLanguage/chunkOverlapTokenNum 序列化进
--      kb_library.rag_settings_json（TEXT），无需 DDL（设计 §3.2 铁律）。
--   C. sys_api 登记 17 个写端点（技术债 11.2 销账，Q5 裁定）+ sys_menu_api 关联。
--      复用既有 kb:* 权限码挂既有页面/按钮菜单，**不新增权限码**（一码一菜单）。
--
-- 【C 段：为什么是 17 个写端点】
--   PRD §3.1 盘点「未挂审计」的 KB 写端点共 17 个（categories/libraries/documents/acls）。
--   其中 3 个（PUT categories/{id}/move、POST categories/{id}/admins、
--   DELETE category-admins/{adminId}）在 V24/V25 已登记 sys_api（91073/91076/91077），
--   本文件仍保留对应行，靠 (method, path) 去重守卫**幂等跳过**，不产生重复规则；
--   实际净新增 14 行。全部 17 个端点在文件尾自检 SQL 里逐条核对。
--
-- 【C 段：段位选取依据（全库实测 grep，2026-08-11）】
--   sys_api      91106 - 91122      —— 空闲（V27 用到 91094-91099，V26 用到 91079/91089/91090）
--   sys_api.code 00900022-00900038  —— 空闲（V17/V18 用 00900001-00900012，V26 用 00900013-00900015，
--                                       V27 用 00900016-00900021）
--   sys_menu_api 91206 - 91222      —— 空闲（V27 用到 91100-91105）
--   无新增 sys_menu / sys_role_permission 行：权限全部复用既有菜单节点
--   （91040-91050 按钮节点、91055 设置分类管理员按钮）。
--
-- 【C 段：一码一菜单硬约束（uk_menu_app_permission）】
--   V1__init_schema.sql:269 部分唯一索引 (app_id, permission) WHERE status=1。
--   本期零新增权限码；17 行 sys_menu_api 全部挂到**已存在**的菜单节点上，
--   每个权限码在其对应菜单上只出现一次，绝不新建菜单行。
--
-- 【C 段：path_pattern 说明】
--   与 V18 同款隔离口径：详情类用 {id:[0-9]+} / {libraryId:[0-9]+} / {adminId:[0-9]+}
--   避免与 /categories/manageable-ids、/documents/reparse-all 等字面路径误匹配。
--   已登记的三个端点（move/admins/移除管理员）沿用既有行原 path（{id}/{adminId}），
--   使 (method, path) 去重守卫能精确命中既有行而幂等跳过。
--
-- 幂等：ADD COLUMN IF NOT EXISTS / 固定 ID + WHERE NOT EXISTS + ON CONFLICT DO NOTHING，
--       可重复执行。约束：不得修改已发布的 V1-V29。
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A. kb_document 解析治理列（KE-03 进度 / KE-04 失败原因）
--    parse_progress：0~100；null=未解析/未知；由 syncOpenParseStatuses 批量回写。
--    parse_error：最近一次解析失败原因（引擎 progress_msg 摘要，≤500 字符）；
--                 成功/重试时清空（设计 §8 parse_error 口径）。
-- ---------------------------------------------------------------------------
ALTER TABLE kb_document ADD COLUMN IF NOT EXISTS parse_progress INT  NULL;
ALTER TABLE kb_document ADD COLUMN IF NOT EXISTS parse_error    TEXT NULL;

COMMENT ON COLUMN kb_document.parse_progress IS '解析进度百分比 0~100；null=未解析/未知；由引擎状态同步批量回写';
COMMENT ON COLUMN kb_document.parse_error    IS '最近一次解析失败原因（引擎 progress_msg 摘要，≤500 字符）；成功/重试时清空';

-- ---------------------------------------------------------------------------
-- C. sys_api 登记 17 个写端点（挂 V17 建的 catalog 91060「知识库工具」）
--    uk_api_method_path 是 (http_method, path_pattern) WHERE type='api' AND status=1
--    的部分唯一索引，故额外用 method+path 去重。
--    sort 取 31-47：紧邻 synonyms(11-21) 与 category-admin(91-98) 之间，无冲突要求。
-- ---------------------------------------------------------------------------
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (91106, 91020, 91060, '00900022', 'api'::sys_api_node_type, '创建知识库分类',       'POST',   '/api/v1/kb/categories',                                                 31, 1, NOW(), NOW()),
    (91107, 91020, 91060, '00900023', 'api'::sys_api_node_type, '修改知识库分类',       'PUT',    '/api/v1/kb/categories/{id:[0-9]+}',                                    32, 1, NOW(), NOW()),
    (91108, 91020, 91060, '00900024', 'api'::sys_api_node_type, '删除知识库分类',       'DELETE', '/api/v1/kb/categories/{id:[0-9]+}',                                    33, 1, NOW(), NOW()),
    -- ↓ 以下 3 行在 V24/V25 已登记（91073/91076/91077），本行由 method+path 守卫幂等跳过
    (91109, 91020, 91060, '00900025', 'api'::sys_api_node_type, '移动分类节点',         'PUT',    '/api/v1/kb/categories/{id}/move',                                       34, 1, NOW(), NOW()),
    (91110, 91020, 91060, '00900026', 'api'::sys_api_node_type, '新增分类管理员',       'POST',   '/api/v1/kb/categories/{id}/admins',                                      35, 1, NOW(), NOW()),
    (91111, 91020, 91060, '00900027', 'api'::sys_api_node_type, '移除分类管理员',       'DELETE', '/api/v1/kb/category-admins/{adminId}',                                  36, 1, NOW(), NOW()),
    (91112, 91020, 91060, '00900028', 'api'::sys_api_node_type, '创建知识库',           'POST',   '/api/v1/kb/libraries',                                                  37, 1, NOW(), NOW()),
    (91113, 91020, 91060, '00900029', 'api'::sys_api_node_type, '修改知识库',           'PUT',    '/api/v1/kb/libraries/{id:[0-9]+}',                                      38, 1, NOW(), NOW()),
    (91114, 91020, 91060, '00900030', 'api'::sys_api_node_type, '修改 RAG 设置',        'PUT',    '/api/v1/kb/libraries/{id:[0-9]+}/engine/settings',                      39, 1, NOW(), NOW()),
    (91115, 91020, 91060, '00900031', 'api'::sys_api_node_type, '上传文档',             'POST',   '/api/v1/kb/libraries/{libraryId:[0-9]+}/documents',                     40, 1, NOW(), NOW()),
    (91116, 91020, 91060, '00900032', 'api'::sys_api_node_type, '修改文档切片配置',     'PUT',    '/api/v1/kb/libraries/{libraryId:[0-9]+}/documents/{id:[0-9]+}/chunk-config', 41, 1, NOW(), NOW()),
    (91117, 91020, 91060, '00900033', 'api'::sys_api_node_type, '启停文档',             'PUT',    '/api/v1/kb/libraries/{libraryId:[0-9]+}/documents/{id:[0-9]+}/enable',     42, 1, NOW(), NOW()),
    (91118, 91020, 91060, '00900034', 'api'::sys_api_node_type, '文档重解析',           'POST',   '/api/v1/kb/libraries/{libraryId:[0-9]+}/documents/{id:[0-9]+}/reparse',    43, 1, NOW(), NOW()),
    (91119, 91020, 91060, '00900035', 'api'::sys_api_node_type, '全部重解析',           'POST',   '/api/v1/kb/libraries/{libraryId:[0-9]+}/documents/reparse-all',           44, 1, NOW(), NOW()),
    (91120, 91020, 91060, '00900036', 'api'::sys_api_node_type, '删除文档',             'DELETE', '/api/v1/kb/libraries/{libraryId:[0-9]+}/documents/{id:[0-9]+}',           45, 1, NOW(), NOW()),
    (91121, 91020, 91060, '00900037', 'api'::sys_api_node_type, '授予库权限',           'POST',   '/api/v1/kb/libraries/{libraryId:[0-9]+}/acls',                           46, 1, NOW(), NOW()),
    (91122, 91020, 91060, '00900038', 'api'::sys_api_node_type, '撤销库权限',           'DELETE', '/api/v1/kb/acls/{id:[0-9]+}',                                            47, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api WHERE module_id = v.module_id AND code = v.code)
  AND NOT EXISTS (
    SELECT 1 FROM sys_api a
    WHERE a.type = 'api' AND a.status = 1
      AND a.http_method = v.http_method AND a.path_pattern = v.path_pattern
  )
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 91060);

-- ---------------------------------------------------------------------------
-- C.2 sys_menu_api 关联：接口 → 承载权限码的既有菜单节点（一码一菜单，零新增菜单）
--     91106 → 91040（kb:category:add）
--     91107 → 91041（kb:category:edit）
--     91108 → 91042（kb:category:delete）
--     91109/91110/91111 → 91055（kb:category:manage；行被守卫跳过则关联同样跳过）
--     91112 → 91043（kb:library:add）
--     91113/91114 → 91044（kb:library:edit）
--     91115 → 91046（kb:document:add）
--     91116/91117/91118/91119 → 91047（kb:document:edit）
--     91120 → 91048（kb:document:delete）
--     91121 → 91049（kb:acl:grant）
--     91122 → 91050（kb:acl:revoke）
--     uk_menu_api_pair(menu_id, api_id) 守卫；V8 已 DROP uk_menu_api_api(api_id)。
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (91206, 91040, 91106, 1, NOW()),
    (91207, 91041, 91107, 1, NOW()),
    (91208, 91042, 91108, 1, NOW()),
    (91209, 91055, 91109, 1, NOW()),
    (91210, 91055, 91110, 1, NOW()),
    (91211, 91055, 91111, 1, NOW()),
    (91212, 91043, 91112, 1, NOW()),
    (91213, 91044, 91113, 1, NOW()),
    (91214, 91044, 91114, 1, NOW()),
    (91215, 91046, 91115, 1, NOW()),
    (91216, 91047, 91116, 1, NOW()),
    (91217, 91047, 91117, 1, NOW()),
    (91218, 91047, 91118, 1, NOW()),
    (91219, 91047, 91119, 1, NOW()),
    (91220, 91048, 91120, 1, NOW()),
    (91221, 91049, 91121, 1, NOW()),
    (91222, 91050, 91122, 1, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE menu_id = v.menu_id AND api_id = v.api_id)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = v.menu_id)
  AND EXISTS (SELECT 1 FROM sys_api  WHERE id = v.api_id);

-- ---------------------------------------------------------------------------
-- 迁移后自检（在你方环境执行 flyway migrate 后手工跑一遍）
--
--   -- 1) A 段两列存在且可空
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'kb_document'
--     AND column_name IN ('parse_progress','parse_error');
--   -- 期望：2 行，全部 is_nullable = YES
--
--   -- 2) 17 个写端点全部在注册表里且 permission 正确（含 3 个 V24/V25 既有行）
--   SELECT a.id, a.http_method, a.path_pattern, m.permission
--   FROM sys_api a
--   JOIN sys_menu_api ma ON ma.api_id = a.id
--   JOIN sys_menu m      ON ma.menu_id = m.id
--   WHERE a.path_pattern LIKE '/api/v1/kb/%'
--     AND a.http_method IN ('POST','PUT','DELETE')
--     AND a.path_pattern NOT LIKE '/api/v1/kb/engine/%'
--     AND a.path_pattern NOT LIKE '/api/v1/kb/synonyms%'
--     AND a.path_pattern NOT LIKE '/api/v1/kb/hit-test'
--     AND a.path_pattern NOT LIKE '/api/v1/kb/qa/%'
--     AND a.path_pattern NOT LIKE '/api/v1/kb/operations/%'
--   ORDER BY a.sort;
--   -- 期望：17 行，permission 分布 =
--   --   categories: add×1 / edit×1 / delete×1 / manage×3（move、admins、移除管理员）
--   --   libraries:  add×1 / edit×3（修改库、RAG 设置、…）
--   --   documents:  add×1 / edit×4（切片配置、启停、重解析、全部重解析）/ delete×1
--   --   acls:       grant×1 / revoke×1
--
--   -- 3) 一码一菜单回归：17 行里每个权限码在其菜单上只出现一次
--   --    （若出现「同一 api 挂多个菜单」即 uk_menu_api_pair 被绕过）
--   SELECT api_id, count(*) FROM sys_menu_api
--   WHERE api_id BETWEEN 91106 AND 91122
--   GROUP BY api_id HAVING count(*) > 1;
--   -- 期望：0 行
--
--   -- 4) 幂等回归：重复执行本文件后 2) 仍是 17 行、3) 仍是 0 行
--
--   -- 5) 行为验收：无 kb:document:edit 的登录用户 POST
--   --    /api/v1/kb/libraries/{id}/documents/reparse-all 期望 HTTP 403
--   --    （BFF 需重启或等注册表 refresh-interval-seconds=300s 到期重载）。
-- ---------------------------------------------------------------------------
