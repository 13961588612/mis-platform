-- ===========================================================================
-- V36__kb_agent_api_domain_catalogs.sql
-- ---------------------------------------------------------------------------
-- 目的：知识库（module 91020）与智能体运营（module 92020）的 sys_api 树
--       从「单根 catalog + 全部叶子平铺」改为「根 catalog → 业务域分组 → 叶子」。
--       管理台「接口模块」页可读性提升；鉴权零影响（只改 parent_id / 新增 catalog）。
--
-- 结构（对齐侧栏 KB_NAV / AGENT_NAV）：
--   91060 知识库工具
--     ├── 91168 分类管理
--     ├── 91169 知识库
--     ├── 91170 文档
--     ├── 91171 搜索权限
--     ├── 91172 智能问答
--     ├── 91173 命中测试
--     ├── 91174 问答运营
--     ├── 91175 同义词
--     └── 91176 引擎配置
--   92090 智能体运营 API
--     ├── 92160 技能池
--     ├── 92161 Agent 实例
--     ├── 92162 会话与对话
--     ├── 92163 MCP
--     ├── 92164 Worker Catalog
--     ├── 92165 调度观测
--     ├── 92166 企微渠道
--     ├── 92167 系统监控
--     └── 92168 审批中心
--
-- 号段（已核对 V35 最高：sys_api 91167 属 module 4；Agent 92159）：
--   KB catalog id 91168-91176 / code 00900073-00900081（module 91020，与 V35 module4 码同号不冲突）
--   Agent catalog id 92160-92168 / code 00920061-00920069
--
-- 叶子迁移：按 path_pattern 规则 UPDATE parent_id（比列 id 更抗 V24/V25 撞号残留）。
-- 幂等：catalog INSERT 守卫 id/code；UPDATE 已挂目标父节点则无实质变更。
-- 前置：V17(91060) / V20(92090) 已存在；V35 为当前最新已发布版本。
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A. KB：9 个业务域 catalog（挂 91060 下）
-- ---------------------------------------------------------------------------
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (91168, 91020, 91060, '00900073', 'catalog'::sys_api_node_type, '分类管理',   NULL::VARCHAR, NULL::VARCHAR, 1,  1, NOW(), NOW()),
    (91169, 91020, 91060, '00900074', 'catalog'::sys_api_node_type, '知识库',     NULL::VARCHAR, NULL::VARCHAR, 2,  1, NOW(), NOW()),
    (91170, 91020, 91060, '00900075', 'catalog'::sys_api_node_type, '文档',       NULL::VARCHAR, NULL::VARCHAR, 3,  1, NOW(), NOW()),
    (91171, 91020, 91060, '00900076', 'catalog'::sys_api_node_type, '搜索权限',   NULL::VARCHAR, NULL::VARCHAR, 4,  1, NOW(), NOW()),
    (91172, 91020, 91060, '00900077', 'catalog'::sys_api_node_type, '智能问答',   NULL::VARCHAR, NULL::VARCHAR, 5,  1, NOW(), NOW()),
    (91173, 91020, 91060, '00900078', 'catalog'::sys_api_node_type, '命中测试',   NULL::VARCHAR, NULL::VARCHAR, 6,  1, NOW(), NOW()),
    (91174, 91020, 91060, '00900079', 'catalog'::sys_api_node_type, '问答运营',   NULL::VARCHAR, NULL::VARCHAR, 7,  1, NOW(), NOW()),
    (91175, 91020, 91060, '00900080', 'catalog'::sys_api_node_type, '同义词',     NULL::VARCHAR, NULL::VARCHAR, 8,  1, NOW(), NOW()),
    (91176, 91020, 91060, '00900081', 'catalog'::sys_api_node_type, '引擎配置',   NULL::VARCHAR, NULL::VARCHAR, 9,  1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api WHERE module_id = v.module_id AND code = v.code)
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 91060);

-- ---------------------------------------------------------------------------
-- B. KB：叶子挂到域分组（先细后粗，避免 LIKE 互相覆盖）
-- ---------------------------------------------------------------------------

-- B.1 文档（含 /documents 路径）
UPDATE sys_api
SET parent_id = 91170, updated_at = NOW()
WHERE module_id = 91020
  AND type = 'api'
  AND status = 1
  AND path_pattern LIKE '%/documents%'
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 91170);

-- B.2 搜索权限（acl + 主体检索）
UPDATE sys_api
SET parent_id = 91171, updated_at = NOW()
WHERE module_id = 91020
  AND type = 'api'
  AND status = 1
  AND (
    path_pattern LIKE '%/acls%'
    OR path_pattern = '/api/v1/kb/subjects/search'
    OR path_pattern LIKE '/api/v1/kb/acls/%'
  )
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 91171);

-- B.3 引擎运维（/engine/** 与 engine-ref；不含库级 /engine/settings）
UPDATE sys_api
SET parent_id = 91176, updated_at = NOW()
WHERE module_id = 91020
  AND type = 'api'
  AND status = 1
  AND (
    path_pattern LIKE '/api/v1/kb/engine/%'
    OR path_pattern LIKE '%/engine-ref%'
  )
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 91176);

-- B.4 分类管理
UPDATE sys_api
SET parent_id = 91168, updated_at = NOW()
WHERE module_id = 91020
  AND type = 'api'
  AND status = 1
  AND (
    path_pattern LIKE '/api/v1/kb/categories%'
    OR path_pattern LIKE '/api/v1/kb/category-admins%'
  )
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 91168);

-- B.5 同义词
UPDATE sys_api
SET parent_id = 91175, updated_at = NOW()
WHERE module_id = 91020
  AND type = 'api'
  AND status = 1
  AND path_pattern LIKE '/api/v1/kb/synonyms%'
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 91175);

-- B.6 智能问答
UPDATE sys_api
SET parent_id = 91172, updated_at = NOW()
WHERE module_id = 91020
  AND type = 'api'
  AND status = 1
  AND path_pattern LIKE '/api/v1/kb/qa/%'
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 91172);

-- B.7 问答运营
UPDATE sys_api
SET parent_id = 91174, updated_at = NOW()
WHERE module_id = 91020
  AND type = 'api'
  AND status = 1
  AND path_pattern LIKE '/api/v1/kb/operations/%'
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 91174);

-- B.8 命中测试
UPDATE sys_api
SET parent_id = 91173, updated_at = NOW()
WHERE module_id = 91020
  AND type = 'api'
  AND status = 1
  AND path_pattern LIKE '/api/v1/kb/hit-test%'
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 91173);

-- B.9 知识库（剩余 libraries：CRUD / 详情 / RAG 设置 / Graph / RAPTOR）
UPDATE sys_api
SET parent_id = 91169, updated_at = NOW()
WHERE module_id = 91020
  AND type = 'api'
  AND status = 1
  AND path_pattern LIKE '/api/v1/kb/libraries%'
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 91169);

-- ---------------------------------------------------------------------------
-- C. Agent：9 个业务域 catalog（挂 92090 下）
-- ---------------------------------------------------------------------------
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (92160, 92020, 92090, '00920061', 'catalog'::sys_api_node_type, '技能池',       NULL::VARCHAR, NULL::VARCHAR, 1,  1, NOW(), NOW()),
    (92161, 92020, 92090, '00920062', 'catalog'::sys_api_node_type, 'Agent 实例',   NULL::VARCHAR, NULL::VARCHAR, 2,  1, NOW(), NOW()),
    (92162, 92020, 92090, '00920063', 'catalog'::sys_api_node_type, '会话与对话',   NULL::VARCHAR, NULL::VARCHAR, 3,  1, NOW(), NOW()),
    (92163, 92020, 92090, '00920064', 'catalog'::sys_api_node_type, 'MCP',          NULL::VARCHAR, NULL::VARCHAR, 4,  1, NOW(), NOW()),
    (92164, 92020, 92090, '00920065', 'catalog'::sys_api_node_type, 'Worker Catalog', NULL::VARCHAR, NULL::VARCHAR, 5,  1, NOW(), NOW()),
    (92165, 92020, 92090, '00920066', 'catalog'::sys_api_node_type, '调度观测',     NULL::VARCHAR, NULL::VARCHAR, 6,  1, NOW(), NOW()),
    (92166, 92020, 92090, '00920067', 'catalog'::sys_api_node_type, '企微渠道',     NULL::VARCHAR, NULL::VARCHAR, 7,  1, NOW(), NOW()),
    (92167, 92020, 92090, '00920068', 'catalog'::sys_api_node_type, '系统监控',     NULL::VARCHAR, NULL::VARCHAR, 8,  1, NOW(), NOW()),
    (92168, 92020, 92090, '00920069', 'catalog'::sys_api_node_type, '审批中心',     NULL::VARCHAR, NULL::VARCHAR, 9,  1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api WHERE module_id = v.module_id AND code = v.code)
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 92090);

-- ---------------------------------------------------------------------------
-- D. Agent：叶子挂到域分组
-- ---------------------------------------------------------------------------

UPDATE sys_api
SET parent_id = 92160, updated_at = NOW()
WHERE module_id = 92020 AND type = 'api' AND status = 1
  AND (
    path_pattern LIKE '/api/v1/agent-ops/skills%'
    OR path_pattern = '/api/v1/agent-ops/roles'
  )
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 92160);

UPDATE sys_api
SET parent_id = 92161, updated_at = NOW()
WHERE module_id = 92020 AND type = 'api' AND status = 1
  AND path_pattern LIKE '/api/v1/agent-ops/agents%'
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 92161);

UPDATE sys_api
SET parent_id = 92162, updated_at = NOW()
WHERE module_id = 92020 AND type = 'api' AND status = 1
  AND (
    path_pattern LIKE '/api/v1/agent-ops/sessions%'
    OR path_pattern LIKE '/api/v1/agent-ops/chat/%'
  )
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 92162);

UPDATE sys_api
SET parent_id = 92163, updated_at = NOW()
WHERE module_id = 92020 AND type = 'api' AND status = 1
  AND path_pattern LIKE '/api/v1/agent-ops/mcp/%'
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 92163);

UPDATE sys_api
SET parent_id = 92164, updated_at = NOW()
WHERE module_id = 92020 AND type = 'api' AND status = 1
  AND path_pattern LIKE '/api/v1/agent-ops/catalog%'
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 92164);

UPDATE sys_api
SET parent_id = 92165, updated_at = NOW()
WHERE module_id = 92020 AND type = 'api' AND status = 1
  AND path_pattern LIKE '/api/v1/agent-ops/dispatch/%'
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 92165);

UPDATE sys_api
SET parent_id = 92166, updated_at = NOW()
WHERE module_id = 92020 AND type = 'api' AND status = 1
  AND path_pattern LIKE '/api/v1/agent-ops/channels/%'
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 92166);

UPDATE sys_api
SET parent_id = 92167, updated_at = NOW()
WHERE module_id = 92020 AND type = 'api' AND status = 1
  AND path_pattern LIKE '/api/v1/agent-ops/monitor/%'
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 92167);

UPDATE sys_api
SET parent_id = 92168, updated_at = NOW()
WHERE module_id = 92020 AND type = 'api' AND status = 1
  AND path_pattern LIKE '/api/v1/agent-ops/approvals%'
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 92168);

-- ---------------------------------------------------------------------------
-- E. 自检（手工）
-- ---------------------------------------------------------------------------
-- -- KB：仍挂在根 91060 下的 api 叶子应 = 0（全部进域分组）
-- SELECT id, name, path_pattern FROM sys_api
-- WHERE module_id = 91020 AND type = 'api' AND parent_id = 91060;
--
-- -- Agent：仍挂在根 92090 下的 api 叶子应 = 0
-- SELECT id, name, path_pattern FROM sys_api
-- WHERE module_id = 92020 AND type = 'api' AND parent_id = 92090;
--
-- -- 分组下叶子计数（KB）
-- SELECT p.name, COUNT(*) AS leaf_cnt
-- FROM sys_api c
-- JOIN sys_api p ON p.id = c.parent_id
-- WHERE c.module_id = 91020 AND c.type = 'api' AND c.parent_id BETWEEN 91168 AND 91176
-- GROUP BY p.name ORDER BY MIN(p.sort);
--
-- -- 分组下叶子计数（Agent）
-- SELECT p.name, COUNT(*) AS leaf_cnt
-- FROM sys_api c
-- JOIN sys_api p ON p.id = c.parent_id
-- WHERE c.module_id = 92020 AND c.type = 'api' AND c.parent_id BETWEEN 92160 AND 92168
-- GROUP BY p.name ORDER BY MIN(p.sort);
