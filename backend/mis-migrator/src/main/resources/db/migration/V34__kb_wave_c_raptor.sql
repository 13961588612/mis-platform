-- ===========================================================================
-- V34__kb_wave_c_raptor.sql —— 知识库 Wave C RAPTOR（T01 数据地基）
-- PostgreSQL 16 | 库名: mis_platform
-- 设计：docs/backend/mis-kb-wave-c-independent-analysis-2026-08-12.md（§3.1 T01）
--       + docs/backend/ragflow-raptor-probe-2026-08-12.md（T00 实测契约）
-- 前置：V33 为当前最新版本；本文件为 V34，Flyway 只追加不修改已发布版本。
--
-- 内容一段：
--   A. sys_api 登记 2 个新端点（RAPTOR 构建触发 + 状态查询）+ sys_menu_api 关联；零 DDL。
--      RagSettings 7 字段（useRaptor / raptorMaxTokenNum / raptorThreshold /
--      raptorMaxCluster / raptorPrompt / raptorBuildStatus / raptorBuildMessage）
--      序列化进 kb_library.rag_settings_json（TEXT），无需 DDL（对齐 Wave B §2.1 铁律）。
--
-- 【A 段：为什么是 2 个端点】
--   Wave C RAPTOR 新增（仿 Wave B §5.2，结构完全同构）：
--     POST /api/v1/kb/libraries/{id}/raptor/build         构建触发（手动/重试）
--     GET  /api/v1/kb/libraries/{id}/raptor/build-status  状态查询（前端 3s 轮询）
--   构建 = 修改引擎侧资源，按「写」对待（BFF 权限码 kb:library:edit +
--   mis-kb 管辖双闸门 hasLibraryManage）；状态查询 = 读操作
--   （权限 kb:library:engine-ref:view），默认不挂审计（对齐 Wave B U6 裁定：
--   3s 轮询刷审计表噪声）。
--
-- 【A 段：段位选取依据（全仓 grep 实测，V33 末段顺延）】
--   sys_api      91155 - 91156      —— V33 用到 91153-91154，本文件顺延
--   sys_api.code 00900071-00900072  —— V33 用到 00900069-00900070，本文件顺延
--   sys_menu_api 91255 - 91256      —— V33 用到 91253-91254，本文件顺延
--   无新增 sys_menu / sys_role_permission 行：权限复用既有按钮节点
--   （91044 kb:library:edit、91056 kb:library:engine-ref:view），一码一菜单。
--
-- 【A 段：path_pattern 说明】
--   沿用 V31 同款 {id:[0-9]+} 路径变量，避免与字面路径误匹配。
--
-- 幂等：固定 ID + WHERE NOT EXISTS + ON CONFLICT DO NOTHING，可重复执行。
-- 约束：不得修改已发布的 V1-V33。
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A. sys_api 登记 2 个新端点（挂 V17 建的 catalog 91060「知识库工具」）
--    uk_api_method_path 是 (http_method, path_pattern) WHERE type='api' AND status=1
--    的部分唯一索引，故额外用 method+path 去重。
--    sort 取 80-81：紧邻 V33 的 78-79 之后，无冲突要求。
-- ---------------------------------------------------------------------------
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (91155, 91020, 91060, '00900071', 'api'::sys_api_node_type, '触发 RAPTOR 摘要构建', 'POST', '/api/v1/kb/libraries/{id:[0-9]+}/raptor/build',        80, 1, NOW(), NOW()),
    (91156, 91020, 91060, '00900072', 'api'::sys_api_node_type, '查询 RAPTOR 构建状态', 'GET',  '/api/v1/kb/libraries/{id:[0-9]+}/raptor/build-status', 81, 1, NOW(), NOW())
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
--     91155 → 91044（kb:library:edit；构建 = 写操作，BFF 权限码闸门）
--     91156 → 91056（kb:library:engine-ref:view；状态查询 = 读操作，不挂审计）
--     uk_menu_api_pair(menu_id, api_id) 守卫；V8 已 DROP uk_menu_api_api(api_id)。
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (91255, 91044, 91155, 1, NOW()),
    (91256, 91056, 91156, 1, NOW())
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
--   WHERE a.id IN (91155, 91156)
--   ORDER BY a.id;
--   -- 期望：
--   --   91155 POST /api/v1/kb/libraries/{id}/raptor/build        | kb:library:edit
--   --   91156 GET  /api/v1/kb/libraries/{id}/raptor/build-status | kb:library:engine-ref:view
--
--   -- 2) 一码一菜单回归：2 行里每个权限码在其菜单上只出现一次
--   SELECT api_id, count(*) FROM sys_menu_api
--   WHERE api_id BETWEEN 91155 AND 91156
--   GROUP BY api_id HAVING count(*) > 1;
--   -- 期望：0 行
--
--   -- 3) 幂等回归：重复执行本文件后 1) 仍是 2 行、2) 仍是 0 行
--
--   -- 4) 行为验收：无 kb:library:edit 的登录用户 POST
--   --    /api/v1/kb/libraries/{id}/raptor/build 期望 HTTP 403
--   --    （BFF 需重启或等注册表 refresh-interval-seconds=300s 到期重载）。
-- ---------------------------------------------------------------------------
