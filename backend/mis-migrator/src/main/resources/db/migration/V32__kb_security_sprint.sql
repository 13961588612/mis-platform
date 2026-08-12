-- ===========================================================================
-- V32__kb_security_sprint.sql —— 技术债 11.2 收尾 + 11.3 前置补登（SEC-03/04）
-- PostgreSQL 16 | 库名: mis_platform
-- 设计：docs/backend/mis-kb-security-sprint-design-2026-08-12.md（施工唯一标准）
-- PRD ：deliverables/software-company/kb-security-sprint-prd-2026-08-12.md（§2.3）
-- 前置：V31 为当前最新版本；本文件为 V32，Flyway 只追加不修改已发布版本。
--
-- 内容一段：
--   A. sys_api 登记 28 个 KB 端点（READ-01~24 + WRITE-01~04）+ sys_menu_api 关联；零 DDL。
--      补登范围 = 块①「读端点留二期」的主体（24 读）+ 块① 审计已挂但从未登记的 4 个写端点。
--      prod 已 deny-unmapped: true（commit 6db58b0，fail-closed 既成事实），
--      未登记端点（含 DELETE /libraries/{id} 删除知识库）在 prod 403 = 直接功能故障，
--      本迁移是「补登先行」的永久修复（Q1 双路径之②）。
--
-- 【A 段：段位选取依据（全库实测 grep，2026-08-12，V31 末段顺延）】
--   sys_api      91125 - 91152      —— V31 用到 91123-91124，本文件顺延
--   sys_api.code 00900041-00900068  —— V31 用到 00900039-00900040，本文件顺延
--   sys_menu_api 91225 - 91252      —— V31 用到 91223-91224，本文件顺延
--   sort         50 - 77            —— V31 用到 48-49，本文件顺延
--   无新增 sys_menu / sys_role_permission 行：权限全部复用既有页面/按钮节点
--   （91032-91038 页面 / 91044 编辑库 / 91045 删除库 / 91051 提交反馈），一码一菜单。
--
-- 【A 段：一码一菜单硬约束（uk_menu_app_permission）】
--   V1__init_schema.sql:269 部分唯一索引 (app_id, permission) WHERE status=1。
--   本期零新增权限码；28 行 sys_menu_api 全部挂到**已存在**的菜单节点上，
--   每个权限码在其对应菜单上只出现一次，绝不新建菜单行（设计 §1.7 核验表）。
--
-- 【A 段：权限码映射（架构师裁决 Q5/Q6/Q8 + 设计 §1.7）】
--   categories             → kb:category:list   (91032)
--   libraries/detail       → kb:library:list    (91033)
--   engine/settings        → kb:library:edit    (91044)   Q6：RAG 设置敏感，「能改才能看」
--   documents              → kb:document:list   (91034)
--   acls + subjects/search → kb:acl:list        (91035)   Q5：授权主体检索属权限页前置
--   qa sessions/feedback   → kb:qa:ask          (91036)
--   operations 9 端点      → kb:operation:list  (91037)   Q8：导出与列表同权
--   engine health/capabilities/models → kb:engine:view (91038)
--   DELETE libraries/{id}  → kb:library:delete  (91045)
--   POST qa/feedback       → kb:qa:feedback     (91051)
--   POST tickets           → kb:qa:ask          (91036)
--   PATCH tickets/{ticketId} → kb:operation:list (91037)
--
-- 【A 段：path_pattern 说明】
--   沿用 V30/V31 同款 {id:[0-9]+} / {libraryId:[0-9]+} 隔离口径，避免与字面路径
--   （sessions/mine、sessions-all、by-session/{sessionId}、capabilities 等）误匹配。
--   {sessionId} / {ticketId} 用单段通配（V31 同款，与字面路径同权并集无害）。
--
-- 幂等：固定 ID + WHERE NOT EXISTS + (method, path) 去重 + ON CONFLICT DO NOTHING，
--       可重复执行。约束：不得修改已发布的 V1-V31。
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A. sys_api 登记 28 个 KB 端点（挂 V17 建的 catalog 91060「知识库工具」）
--    uk_api_method_path 是 (http_method, path_pattern) WHERE type='api' AND status=1
--    的部分唯一索引，故额外用 method+path 去重。
-- ---------------------------------------------------------------------------
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    -- READ-01~24（id 91125-91148 / code 00900041-00900064 / sort 50-73）
    (91125, 91020, 91060, '00900041', 'api'::sys_api_node_type, '查询知识库分类',          'GET',    '/api/v1/kb/categories',                                                   50, 1, NOW(), NOW()),
    (91126, 91020, 91060, '00900042', 'api'::sys_api_node_type, '查询知识库列表',          'GET',    '/api/v1/kb/libraries',                                                   51, 1, NOW(), NOW()),
    (91127, 91020, 91060, '00900043', 'api'::sys_api_node_type, '查询知识库详情',          'GET',    '/api/v1/kb/libraries/{id:[0-9]+}',                                      52, 1, NOW(), NOW()),
    (91128, 91020, 91060, '00900044', 'api'::sys_api_node_type, '查询知识库详情聚合',      'GET',    '/api/v1/kb/libraries/{id:[0-9]+}/detail',                                53, 1, NOW(), NOW()),
    (91129, 91020, 91060, '00900045', 'api'::sys_api_node_type, '读取 RAG 设置',           'GET',    '/api/v1/kb/libraries/{id:[0-9]+}/engine/settings',                      54, 1, NOW(), NOW()),
    (91130, 91020, 91060, '00900046', 'api'::sys_api_node_type, '查询文档列表',            'GET',    '/api/v1/kb/libraries/{libraryId:[0-9]+}/documents',                     55, 1, NOW(), NOW()),
    (91131, 91020, 91060, '00900047', 'api'::sys_api_node_type, '查询文档详情',            'GET',    '/api/v1/kb/libraries/{libraryId:[0-9]+}/documents/{id:[0-9]+}',         56, 1, NOW(), NOW()),
    (91132, 91020, 91060, '00900048', 'api'::sys_api_node_type, '查询库权限列表',          'GET',    '/api/v1/kb/libraries/{libraryId:[0-9]+}/acls',                          57, 1, NOW(), NOW()),
    (91133, 91020, 91060, '00900049', 'api'::sys_api_node_type, '查询我的问答会话',        'GET',    '/api/v1/kb/qa/sessions/mine',                                           58, 1, NOW(), NOW()),
    (91134, 91020, 91060, '00900050', 'api'::sys_api_node_type, '查询问答会话详情',        'GET',    '/api/v1/kb/qa/sessions/{sessionId}',                                    59, 1, NOW(), NOW()),
    (91135, 91020, 91060, '00900051', 'api'::sys_api_node_type, '查询问答反馈',            'GET',    '/api/v1/kb/qa/sessions/{sessionId}/feedback',                           60, 1, NOW(), NOW()),
    (91136, 91020, 91060, '00900052', 'api'::sys_api_node_type, '运营问答列表',            'GET',    '/api/v1/kb/operations/qa/sessions',                                     61, 1, NOW(), NOW()),
    (91137, 91020, 91060, '00900053', 'api'::sys_api_node_type, '运营问答详情',            'GET',    '/api/v1/kb/operations/qa/sessions/{sessionId}',                         62, 1, NOW(), NOW()),
    (91138, 91020, 91060, '00900054', 'api'::sys_api_node_type, '运营全量会话列表',        'GET',    '/api/v1/kb/operations/qa/sessions-all',                                 63, 1, NOW(), NOW()),
    (91139, 91020, 91060, '00900055', 'api'::sys_api_node_type, '运营反馈列表',            'GET',    '/api/v1/kb/operations/qa/feedback',                                     64, 1, NOW(), NOW()),
    (91140, 91020, 91060, '00900056', 'api'::sys_api_node_type, '运营评价看板',            'GET',    '/api/v1/kb/operations/stats',                                           65, 1, NOW(), NOW()),
    (91141, 91020, 91060, '00900057', 'api'::sys_api_node_type, '运营记录 CSV 导出',       'GET',    '/api/v1/kb/operations/qa/export',                                       66, 1, NOW(), NOW()),
    (91142, 91020, 91060, '00900058', 'api'::sys_api_node_type, '运营工单列表',            'GET',    '/api/v1/kb/operations/qa/tickets',                                      67, 1, NOW(), NOW()),
    (91143, 91020, 91060, '00900059', 'api'::sys_api_node_type, '运营工单详情',            'GET',    '/api/v1/kb/operations/qa/tickets/{ticketId}',                          68, 1, NOW(), NOW()),
    (91144, 91020, 91060, '00900060', 'api'::sys_api_node_type, '会话侧栏工单列表',        'GET',    '/api/v1/kb/operations/qa/tickets/by-session/{sessionId}',               69, 1, NOW(), NOW()),
    (91145, 91020, 91060, '00900061', 'api'::sys_api_node_type, '授权主体检索',            'GET',    '/api/v1/kb/subjects/search',                                            70, 1, NOW(), NOW()),
    (91146, 91020, 91060, '00900062', 'api'::sys_api_node_type, '查询引擎健康',            'GET',    '/api/v1/kb/engine/health',                                              71, 1, NOW(), NOW()),
    (91147, 91020, 91060, '00900063', 'api'::sys_api_node_type, '查询引擎能力',            'GET',    '/api/v1/kb/engine/capabilities',                                        72, 1, NOW(), NOW()),
    (91148, 91020, 91060, '00900064', 'api'::sys_api_node_type, '查询引擎模型池',          'GET',    '/api/v1/kb/engine/models',                                              73, 1, NOW(), NOW()),
    -- WRITE-01~04（id 91149-91152 / code 00900065-00900068 / sort 74-77）
    (91149, 91020, 91060, '00900065', 'api'::sys_api_node_type, '删除/归档知识库',         'DELETE', '/api/v1/kb/libraries/{id:[0-9]+}',                                      74, 1, NOW(), NOW()),
    (91150, 91020, 91060, '00900066', 'api'::sys_api_node_type, '提交问答反馈',            'POST',   '/api/v1/kb/qa/feedback',                                                75, 1, NOW(), NOW()),
    (91151, 91020, 91060, '00900067', 'api'::sys_api_node_type, '创建问答工单',            'POST',   '/api/v1/kb/operations/qa/tickets',                                      76, 1, NOW(), NOW()),
    (91152, 91020, 91060, '00900068', 'api'::sys_api_node_type, '处理问答工单',            'PATCH',  '/api/v1/kb/operations/qa/tickets/{ticketId}',                           77, 1, NOW(), NOW())
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
--     91125         → 91032（kb:category:list）
--     91126/27/28   → 91033（kb:library:list）
--     91129         → 91044（kb:library:edit；Q6 敏感设置能改才能看）
--     91130/31      → 91034（kb:document:list）
--     91132/91145   → 91035（kb:acl:list；Q5 授权主体检索属权限页前置）
--     91133/34/35   → 91036（kb:qa:ask）
--     91136~44/91152 → 91037（kb:operation:list；Q8 导出同权）
--     91146/47/48   → 91038（kb:engine:view）
--     91149         → 91045（kb:library:delete）
--     91150         → 91051（kb:qa:feedback）
--     91151         → 91036（kb:qa:ask）
--     uk_menu_api_pair(menu_id, api_id) 守卫；V8 已 DROP uk_menu_api_api(api_id)。
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (91225, 91032, 91125, 1, NOW()),
    (91226, 91033, 91126, 1, NOW()),
    (91227, 91033, 91127, 1, NOW()),
    (91228, 91033, 91128, 1, NOW()),
    (91229, 91044, 91129, 1, NOW()),
    (91230, 91034, 91130, 1, NOW()),
    (91231, 91034, 91131, 1, NOW()),
    (91232, 91035, 91132, 1, NOW()),
    (91233, 91036, 91133, 1, NOW()),
    (91234, 91036, 91134, 1, NOW()),
    (91235, 91036, 91135, 1, NOW()),
    (91236, 91037, 91136, 1, NOW()),
    (91237, 91037, 91137, 1, NOW()),
    (91238, 91037, 91138, 1, NOW()),
    (91239, 91037, 91139, 1, NOW()),
    (91240, 91037, 91140, 1, NOW()),
    (91241, 91037, 91141, 1, NOW()),
    (91242, 91037, 91142, 1, NOW()),
    (91243, 91037, 91143, 1, NOW()),
    (91244, 91037, 91144, 1, NOW()),
    (91245, 91035, 91145, 1, NOW()),
    (91246, 91038, 91146, 1, NOW()),
    (91247, 91038, 91147, 1, NOW()),
    (91248, 91038, 91148, 1, NOW()),
    (91249, 91045, 91149, 1, NOW()),
    (91250, 91051, 91150, 1, NOW()),
    (91251, 91036, 91151, 1, NOW()),
    (91252, 91037, 91152, 1, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE menu_id = v.menu_id AND api_id = v.api_id)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = v.menu_id)
  AND EXISTS (SELECT 1 FROM sys_api  WHERE id = v.api_id);

-- ---------------------------------------------------------------------------
-- 迁移后自检（在你方环境执行 flyway migrate 后手工跑一遍）
--
--   -- 1) 28 个端点全部在注册表里且 permission 正确（分布对照设计 §1.7）
--   SELECT a.id, a.http_method, a.path_pattern, m.permission
--   FROM sys_api a
--   JOIN sys_menu_api ma ON ma.api_id = a.id
--   JOIN sys_menu m      ON ma.menu_id = m.id
--   WHERE a.id BETWEEN 91125 AND 91152
--   ORDER BY a.id;
--   -- 期望：28 行；permission 分布 =
--   --   kb:category:list ×1 (91125)
--   --   kb:library:list ×3 (91126/91127/91128)
--   --   kb:library:edit ×1 (91129)
--   --   kb:document:list ×2 (91130/91131)
--   --   kb:acl:list ×2 (91132/91145)
--   --   kb:qa:ask ×4 (91133/91134/91135/91151)
--   --   kb:operation:list ×10 (91136~91144 + 91152)
--   --   kb:engine:view ×3 (91146/91147/91148)
--   --   kb:library:delete ×1 (91149)
--   --   kb:qa:feedback ×1 (91150)
--
--   -- 2) 一码一菜单回归：28 行里每个 api 只挂一个菜单
--   SELECT api_id, count(*) FROM sys_menu_api
--   WHERE api_id BETWEEN 91125 AND 91152
--   GROUP BY api_id HAVING count(*) > 1;
--   -- 期望：0 行
--
--   -- 3) uk_menu_app_permission 冲突回归：本迁移挂载的权限码在各自菜单上不重复
--   SELECT m.permission, COUNT(*)
--   FROM sys_menu_api ma
--   JOIN sys_menu m ON ma.menu_id = m.id
--   WHERE ma.api_id BETWEEN 91125 AND 91152
--     AND m.permission IS NOT NULL
--   GROUP BY m.permission, m.app_id, m.id
--   HAVING COUNT(*) > 1;
--   -- 期望：0 行（同一菜单节点上同权限码只出现一次）
--
--   -- 4) 冲突回归：28 行与全量注册表 (method, path) 无重复
--   SELECT 1 FROM sys_api
--   WHERE type = 'api' AND status = 1
--     AND (http_method, path_pattern) IN (
--       SELECT http_method, path_pattern FROM sys_api WHERE id BETWEEN 91125 AND 91152
--     )
--   GROUP BY 1 HAVING COUNT(*) > 1;
--   -- 期望：0 行
--
--   -- 5) 幂等回归：重复执行本文件后 1) 仍是 28 行、2)/3)/4) 仍是 0 行
--
--   -- 6) 行为验收：无 kb:library:delete 的登录用户 DELETE
--   --    /api/v1/kb/libraries/{id} 期望 HTTP 403（有 kb:library:delete 的管理员 200）
--   --    （BFF 需重启或等注册表 refresh-interval-seconds=300s 到期重载）。
-- ---------------------------------------------------------------------------
