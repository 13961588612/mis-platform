-- ===========================================================================
-- V35__modules_api_registry.sql —— 非 KB 域未登记端点补登（modules 10，差集清零）
-- PostgreSQL 16 | 库名: mis_platform
-- 设计：docs/backend/mis-kb-security-sprint-v34-design-2026-08-12.md（施工唯一标准）
-- 前置：V33 为原最新；V34 已由 KB Wave C RAPTOR（V34__kb_wave_c_raptor.sql）占用，
--       本文件为 V35，Flyway 只追加不修改已发布版本。
--
-- 版本号说明（主理人裁决 Option A，2026-08-12）：
--   迁移目录先存在 V34__kb_wave_c_raptor.sql（KB Wave C RAPTOR，sys_api
--   91155-91156 / code 00900071-00900072 / menu_api 91255-91256 / sort 80-81），
--   与本专项原设计 V34 + 段位 91155+ 撞车。先到先得 → V34 让给 Wave C；
--   本专项改 **V35**，段位整体顺延至 Wave C 之后。
--
-- 内容一段：
--   A. sys_api 登记 10 个 modules 端点（catalog 91157 + api 91158-91167）
--      + sys_menu_api 关联（91257-91266）；零 DDL。
--
-- 背景：SEC-02 差集盘点（BffApiRegistryDiffSurveyTest）原报 modules 10 未登记；
--       roles 2 / apps 1 / employees 1 经代码+连库核验实际已登记（V4/V5），
--       属盘点工具 fixture 漏 V4/V5 的误报，由 T0 纠偏 fixture + 差集清单，
--       **本迁移不重复登记这 4 项**（重复会撞 uk_api_method_path 被幂等跳过）。
--       modules 10 全仓 grep /api/v1/modules 零匹配（V8 只建菜单未建 sys_api），
--       真未登记，本迁移补登。
--
-- 【A 段：段位选取依据（2026-08-12 代码库 grep + 集成库精确区间核验，V34 Wave C 末段顺延）】
--   sys_api      91157 - 91167      —— V34 Wave C 用到 91155-91156，本文件顺延
--   sys_api.code 00900073-00900083  —— V34 Wave C 用到 00900071-00900072，本文件顺延
--   sys_menu_api 91257 - 91266      —— V34 Wave C 用到 91255-91256，本文件顺延
--   sort         92 - 101           —— V34 Wave C 用到 80-81；82-91 有 KB 91060/91075
--                                      存量 sort 90/91（非本树），故选 92-101 完全干净
--   （核验：91157-91167 / 00900073-00900083 / 91257-91266 / sort 92-101 代码库+集成库 0 占用）
--
-- 【A 段：一码一菜单硬约束（uk_menu_app_permission）】
--   本期**零新增权限码、零新增 sys_menu 行**：复用 V8 建的四个既有权限码
--   system:module:list(菜单 207 接口模块页) / system:module:add(271 新增模块按钮)
--   / system:module:edit(272 编辑模块按钮) / system:module:delete(273 删除模块按钮)，
--   一码一菜单成立；10 行 sys_menu_api 全部挂到既有菜单节点（V8 已授 role_id=1）。
--
-- 【A 段：path_pattern 隔离口径】
--   沿用 V30/V31/V32 同款 {id:[0-9]+} / {moduleId:[0-9]+} / {apiId:[0-9]+}
--   单段通配写法（AntPathMatcher 单段通配，与 BFF 导出归一化后逐字一致）；
--   字面路径（/apis、/bindings 为子段）逐字登记，避免与 {moduleId} 误匹配。
--
-- 幂等：固定 ID + WHERE NOT EXISTS + (module_id, code) 去重 + (method, path) 去重
--       + 父行存在性检查，可重复执行。约束：不得修改已发布的 V1-V34。
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A.1 catalog 节点（模块域缺 sys_api 树根，新建 91157 挂 module 4 / parent 4000）
--     V8 只建了菜单 207/271/272/273，从未建 sys_api 树；U-V34-5 裁决新建 catalog。
-- ---------------------------------------------------------------------------
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (91157, 4, 4000, '00900073', 'catalog'::sys_api_node_type, '接口模块管理', NULL, NULL, 5, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api WHERE module_id = v.module_id AND code = v.code)
  AND EXISTS (SELECT 1 FROM sys_module WHERE id = 4)
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 4000);

-- ---------------------------------------------------------------------------
-- A.2 sys_api 10 个叶子（id 91158-91167 / code 00900074-00900083 / sort 92-101）
--     uk_api_method_path 是 (http_method, path_pattern) WHERE type='api' AND status=1
--     的部分唯一索引，故额外用 method+path 去重。
-- ---------------------------------------------------------------------------
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    -- M-01~M-10（id 91158-91167 / code 00900074-00900083 / sort 92-101）
    (91158, 4, 91157, '00900074', 'api'::sys_api_node_type, '查询模块列表',     'GET',    '/api/v1/modules',                                 92, 1, NOW(), NOW()),
    (91159, 4, 91157, '00900075', 'api'::sys_api_node_type, '查询模块详情',     'GET',    '/api/v1/modules/{id:[0-9]+}',                     93, 1, NOW(), NOW()),
    (91160, 4, 91157, '00900076', 'api'::sys_api_node_type, '新建模块',         'POST',   '/api/v1/modules',                                 94, 1, NOW(), NOW()),
    (91161, 4, 91157, '00900077', 'api'::sys_api_node_type, '编辑模块',         'PUT',    '/api/v1/modules/{id:[0-9]+}',                     95, 1, NOW(), NOW()),
    (91162, 4, 91157, '00900078', 'api'::sys_api_node_type, '删除模块',         'DELETE', '/api/v1/modules/{id:[0-9]+}',                     96, 1, NOW(), NOW()),
    (91163, 4, 91157, '00900079', 'api'::sys_api_node_type, '模块 API 树',      'GET',    '/api/v1/modules/{moduleId:[0-9]+}/apis',          97, 1, NOW(), NOW()),
    (91164, 4, 91157, '00900080', 'api'::sys_api_node_type, '新增模块 API',     'POST',   '/api/v1/modules/{moduleId:[0-9]+}/apis',          98, 1, NOW(), NOW()),
    (91165, 4, 91157, '00900081', 'api'::sys_api_node_type, '编辑模块 API',     'PUT',    '/api/v1/modules/apis/{apiId:[0-9]+}',             99, 1, NOW(), NOW()),
    (91166, 4, 91157, '00900082', 'api'::sys_api_node_type, '删除模块 API',     'DELETE', '/api/v1/modules/apis/{apiId:[0-9]+}',             100, 1, NOW(), NOW()),
    (91167, 4, 91157, '00900083', 'api'::sys_api_node_type, '模块绑定列表',     'GET',    '/api/v1/modules/{moduleId:[0-9]+}/bindings',      101, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api WHERE module_id = v.module_id AND code = v.code)
  AND NOT EXISTS (
    SELECT 1 FROM sys_api a
    WHERE a.type = 'api' AND a.status = 1
      AND a.http_method = v.http_method AND a.path_pattern = v.path_pattern
  )
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 91157);

-- ---------------------------------------------------------------------------
-- A.3 sys_menu_api 关联：接口 → 承载权限码的既有菜单节点（一码一菜单，零新增菜单）
--     91158/91159/91163/91167 → 207（system:module:list）
--     91160/91164             → 271（system:module:add；U-V34-2 裁决 POST apis 用 add）
--     91161/91165             → 272（system:module:edit）
--     91162/91166             → 273（system:module:delete）
--     uk_menu_api_pair(menu_id, api_id) 守卫；V8 已 DROP uk_menu_api_api(api_id)。
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (91257, 207, 91158, 1, NOW()),
    (91258, 207, 91159, 1, NOW()),
    (91259, 271, 91160, 1, NOW()),
    (91260, 272, 91161, 1, NOW()),
    (91261, 273, 91162, 1, NOW()),
    (91262, 207, 91163, 1, NOW()),
    (91263, 271, 91164, 1, NOW()),
    (91264, 272, 91165, 1, NOW()),
    (91265, 273, 91166, 1, NOW()),
    (91266, 207, 91167, 1, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE menu_id = v.menu_id AND api_id = v.api_id)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = v.menu_id)
  AND EXISTS (SELECT 1 FROM sys_api  WHERE id = v.api_id);

-- ---------------------------------------------------------------------------
-- 迁移后自检（在你方环境执行 flyway migrate 后手工跑一遍）
--
--   -- 1) 10 个端点全部在注册表里且 permission 正确（分布 = list×4 / add×2 / edit×2 / delete×2）
--   SELECT a.id, a.http_method, a.path_pattern, m.permission
--   FROM sys_api a
--   JOIN sys_menu_api ma ON ma.api_id = a.id
--   JOIN sys_menu m      ON ma.menu_id = m.id
--   WHERE a.id BETWEEN 91157 AND 91167 AND a.type = 'api'
--   ORDER BY a.id;
--   -- 期望：10 行；permission 分布 =
--   --   system:module:list ×4 (91158/91159/91163/91167)
--   --   system:module:add ×2 (91160/91164)
--   --   system:module:edit ×2 (91161/91165)
--   --   system:module:delete ×2 (91162/91166)
--
--   -- 2) 一码一菜单回归：10 行里每个 api 只挂一个菜单
--   SELECT api_id, count(*) FROM sys_menu_api
--   WHERE api_id BETWEEN 91158 AND 91167
--   GROUP BY api_id HAVING count(*) > 1;
--   -- 期望：0 行
--
--   -- 3) uk_menu_app_permission 冲突回归：本迁移挂载的权限码在各自菜单上不重复
--   SELECT m.permission, COUNT(*)
--   FROM sys_menu_api ma
--   JOIN sys_menu m ON ma.menu_id = m.id
--   WHERE ma.api_id BETWEEN 91158 AND 91167
--     AND m.permission IS NOT NULL
--   GROUP BY m.permission, m.app_id, m.id
--   HAVING COUNT(*) > 1;
--   -- 期望：0 行（同一菜单节点上同权限码只出现一次）
--
--   -- 4) 冲突回归：10 行与全量注册表 (method, path) 无重复
--   SELECT http_method, path_pattern, count(*)
--   FROM sys_api
--   WHERE type = 'api' AND status = 1
--     AND (http_method, path_pattern) IN (
--       SELECT http_method, path_pattern FROM sys_api WHERE id BETWEEN 91158 AND 91167
--     )
--   GROUP BY http_method, path_pattern
--   HAVING COUNT(*) > 1;
--   -- 期望：0 行（按 (http_method, path_pattern) 真实分组；勿用 GROUP BY 1 常量分组，
--   --   否则会把全部匹配行聚成一组 count=N>1 恒返回非空——V32 同款缺陷已在此修正）
--
--   -- 5) 幂等回归：重复执行本文件后 1) 仍是 10 行、2)/3)/4) 仍是 0 行
--
--   -- 6) 行为验收：无 system:module:list 的登录用户 GET /api/v1/modules 期望 HTTP 403
--   --    （有该码的管理员 200；BFF 需重启或等注册表 refresh-interval-seconds=300s 到期重载）。
-- ---------------------------------------------------------------------------
