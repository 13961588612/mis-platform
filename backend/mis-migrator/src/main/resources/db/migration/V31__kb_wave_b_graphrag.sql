-- ===========================================================================
-- V31__kb_wave_b_graphrag.sql —— 知识库 Wave B GraphRAG PoC（T01 数据地基）
-- PostgreSQL 16 | 库名: mis_platform
-- 设计：docs/backend/mis-kb-wave-b-graphrag-design-2026-08-11.md（施工唯一标准）
-- 前置：V30 为当前最新版本；本文件为 V31，Flyway 只追加不修改已发布版本。
--
-- 内容一段：
--   A. sys_api 登记 2 个新端点（构图触发 + 状态查询）+ sys_menu_api 关联；零 DDL。
--      RagSettings 三字段（useKnowledgeGraph / kgBuildStatus / kgBuildMessage）
--      序列化进 kb_library.rag_settings_json（TEXT），无需 DDL（设计 §2.1 铁律）。
--
-- 【A 段：为什么是 2 个端点】
--   Wave B GraphRAG PoC 新增（设计 §5.2）：
--     POST /api/v1/kb/libraries/{id}/graph/build         构图触发（手动/重试）
--     GET  /api/v1/kb/libraries/{id}/graph/build-status  状态查询（前端 3s 轮询）
--   构图 = 修改引擎侧资源，按「写」对待（BFF 权限码 kb:library:edit +
--   mis-kb 管辖双闸门 hasLibraryManage，设计 §2.5）；状态查询 = 读操作
--   （权限 kb:library:engine-ref:view），默认不挂审计（U6 裁定：3s 轮询刷表噪声）。
--
-- 【A 段：段位选取依据（全库实测，V30 末段顺延）】
--   sys_api      91123 - 91124      —— V30 用到 91106-91122，本文件顺延
--   sys_api.code 00900039-00900040  —— V30 用到 00900022-00900038，本文件顺延
--   sys_menu_api 91223 - 91224      —— V30 用到 91206-91222，本文件顺延
--   无新增 sys_menu / sys_role_permission 行：权限复用既有按钮节点
--   （91044 kb:library:edit、91056 kb:library:engine-ref:view），一码一菜单。
--
-- 【A 段：path_pattern 说明】
--   沿用 V30 同款 {id:[0-9]+} 路径变量，避免与字面路径误匹配。
--
-- 幂等：固定 ID + WHERE NOT EXISTS + ON CONFLICT DO NOTHING，可重复执行。
-- 约束：不得修改已发布的 V1-V30。
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A. sys_api 登记 2 个新端点（挂 V17 建的 catalog 91060「知识库工具」）
--    uk_api_method_path 是 (http_method, path_pattern) WHERE type='api' AND status=1
--    的部分唯一索引，故额外用 method+path 去重。
--    sort 取 48-49：紧邻 V30 的 31-47 之后，无冲突要求。
-- ---------------------------------------------------------------------------
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (91123, 91020, 91060, '00900039', 'api'::sys_api_node_type, '触发知识图谱构建', 'POST', '/api/v1/kb/libraries/{id:[0-9]+}/graph/build',        48, 1, NOW(), NOW()),
    (91124, 91020, 91060, '00900040', 'api'::sys_api_node_type, '查询图谱构建状态', 'GET',  '/api/v1/kb/libraries/{id:[0-9]+}/graph/build-status', 49, 1, NOW(), NOW())
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
-- A.2 sys_menu_api 关联：接口 → 承载权限码的既有菜单节点（一码一菜单，零新增菜单）
--     91123 → 91044（kb:library:edit；构图 = 写操作，BFF 权限码闸门）
--     91124 → 91056（kb:library:engine-ref:view；状态查询 = 读操作，U6 不挂审计）
--     uk_menu_api_pair(menu_id, api_id) 守卫；V8 已 DROP uk_menu_api_api(api_id)。
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (91223, 91044, 91123, 1, NOW()),
    (91224, 91056, 91124, 1, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE menu_id = v.menu_id AND api_id = v.api_id)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = v.menu_id)
  AND EXISTS (SELECT 1 FROM sys_api  WHERE id = v.api_id);

-- ---------------------------------------------------------------------------
-- 迁移后自检（在你方环境执行 flyway migrate 后手工跑一遍）
--
--   -- 1) 2 个新端点全部在注册表里且 permission 正确
--   SELECT a.id, a.http_method, a.path_pattern, m.permission
--   FROM sys_api a
--   JOIN sys_menu_api ma ON ma.api_id = a.id
--   JOIN sys_menu m      ON ma.menu_id = m.id
--   WHERE a.id IN (91123, 91124)
--   ORDER BY a.id;
--   -- 期望：
--   --   91123 POST /api/v1/kb/libraries/{id}/graph/build        | kb:library:edit
--   --   91124 GET  /api/v1/kb/libraries/{id}/graph/build-status | kb:library:engine-ref:view
--
--   -- 2) 一码一菜单回归：2 行里每个权限码在其菜单上只出现一次
--   SELECT api_id, count(*) FROM sys_menu_api
--   WHERE api_id BETWEEN 91123 AND 91124
--   GROUP BY api_id HAVING count(*) > 1;
--   -- 期望：0 行
--
--   -- 3) 幂等回归：重复执行本文件后 1) 仍是 2 行、2) 仍是 0 行
--
--   -- 4) 行为验收：无 kb:library:edit 的登录用户 POST
--   --    /api/v1/kb/libraries/{id}/graph/build 期望 HTTP 403
--   --    （BFF 需重启或等注册表 refresh-interval-seconds=300s 到期重载）。
-- ---------------------------------------------------------------------------
