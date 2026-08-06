-- MIS Platform — 智能体运营控制台 操作码（按钮节点）+ API 级权限登记
-- PostgreSQL 16 | 库名: mis_platform
-- 施工图：impl-plan.md §4.3（BFF 端点 ⇄ 下游 ⇄ 权限码 全映射）/ §5.3 操作码 / §7 T01
-- 前置：V19__agent_ops_seed.sql（sys_app 92010 / sys_module 92020 / 菜单 92030–92045）
--
-- ---------------------------------------------------------------------------
-- 【本文件为什么必须存在 —— 不建 sys_api 就等于没做权限】
--   BFF 的 API 判权规则源是 SysApiRepository.findRegistryRows()：
--     sys_api ⋈ sys_menu_api ⋈ sys_menu ⋈ sys_module，permission 取自 sys_menu。
--   而 mis-admin-bff 配置 `mis.api-permission.deny-unmapped: false`（未映射即放行），
--   叠加 ApiPermissionRegistry.java:69-73「permission 为空 ⇒ authOnly」+
--   ApiPermissionInterceptor.java:72-73「authOnly 直接 return true」，结果是：
--     只建菜单不建 sys_api ⇒ 权限码只控制侧栏显隐，任何登录用户都能直接调
--     POST /api/v1/agent-ops/mcp/servers/{name}/call 执行任意 MCP 工具。
--   这正是 V17 文件头记录的历史缺口（KB 自 V13 起从未写 sys_api），本文件不重蹈。
--
-- ---------------------------------------------------------------------------
-- 【ID / code 段位】impl-plan §5.1
--   92051–92063   sys_menu   按钮节点（13 个操作码，§5.3 逐条对齐；92050 刻意留空未用）
--   92090         sys_api    catalog 根节点，code='0092'
--   92100–92157   sys_api    api 节点（58 条），code='00920001'…'00920058'
--   92100–92157   sys_menu_api  关联行（与 api_id 同号，便于人工比对）
--   92051–92063   sys_role_permission 授权行（复用 menu.id，见第 4 节）
--
-- ---------------------------------------------------------------------------
-- 【schema 陷阱 —— 逐条与 V1/V8 原文核对过，照抄旧模板必炸】
--   D5  V8__module_api_refactor.sql 已 `DROP COLUMN tenant_id` / `DROP COLUMN app_id`，
--       并把 uk_api_app_code(app_id, code) 换成 uk_api_module_code(module_id, code)、
--       新增 FK fk_api_module → sys_module(id)。
--       ⇒ 本文件 sys_api 的 INSERT 列清单**没有** tenant_id / app_id。
--         照抄 V2/V6（V8 之前的旧 schema）会直接报
--         「column "tenant_id" of relation "sys_api" does not exist」。
--   D12 sys_api 是树：type 是枚举 sys_api_node_type('catalog','api')，需显式
--       `::sys_api_node_type` 标注；code 是**数字串**约定（V17 实测 catalog='0090'、
--       api='00900001'），不是 `agent:xxx` 这种语义码。
--   D13 uk_api_method_path (V1:290) UNIQUE (http_method, path_pattern)
--       WHERE type='api' AND status=1 ⇒ 同一「方法+路径」全局只能登记一次。
--       本文件 58 行的 (method, path) 两两不重（文末自检 2 可验证），
--       且每行都带 NOT EXISTS(method, path) 去重，重复执行安全。
--   D6  ⚠️ **impl-plan §1.6 D6 的说法已过时**：uk_menu_api_api(api_id) 确实在
--       V1__init_schema.sql:301 建过，但 **V8__module_api_refactor.sql:37 已
--       `ALTER TABLE sys_menu_api DROP CONSTRAINT IF EXISTS uk_menu_api_api`**，
--       现存约束只剩 uk_menu_api_pair(menu_id, api_id)。V17 文件头已记录这一点。
--       ⇒ 「一个 api 只能挂一个菜单」在库层面已不再强制。
--       本文件仍**主动遵守** 1 api → 1 menu：ApiPermissionRegistry.match() 会把命中的
--       多条规则的 permission 取**并集且任一即可**（该文件 :78-82 原文），
--       一个端点挂两个菜单 = 两个码任一可通过 = 权限被稀释。这是安全要求，不是 schema 要求。
--   D3  uk_menu_app_permission (V1:269) ⇒ 本文件 13 个按钮码与 V19 的 15 个页面码
--       在 app 92010 内两两不重，合计 28 个（文末自检 0 可验证）。
--
-- 幂等：固定 ID + WHERE NOT EXISTS + 父行存在性检查 + (method,path) 去重，可重复执行。
-- 约束：append-only，不得修改 V1–V19。
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. 操作码按钮节点（type=3），逐条对齐 impl-plan §5.3
--
--    按钮节点不进侧栏（SideNav 只渲染 type=1|2），只承载 permission，
--    供前端 PermissionGate 控制按钮显隐 + 第 3 节的 sys_menu_api 提供 API 判权码。
--    parent 取各自的页面节点（V19 建的 92031–92042），保证菜单树层级正确。
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    -- 技能池（父 92037 /agent/skills）
    (92051, 1, 92010, 92037, 'agent_skill_manage',       '技能创建/编辑/删除/启停', 3, NULL, NULL, 'agent:skill:manage',            NULL, 1, 1, 1, NOW(), NOW()),
    (92052, 1, 92010, 92037, 'agent_skill_reindex',      '重建技能索引',            3, NULL, NULL, 'agent:skill:reindex',           NULL, 2, 1, 1, NOW(), NOW()),
    -- Agent 总览（父 92034 /agent/agents）
    (92053, 1, 92010, 92034, 'agent_agent_manage',       'Agent 启停',              3, NULL, NULL, 'agent:agent:manage',            NULL, 1, 1, 1, NOW(), NOW()),
    (92054, 1, 92010, 92034, 'agent_agent_skills_save',  '保存 Agent 技能绑定',     3, NULL, NULL, 'agent:agent:skills:save',       NULL, 2, 1, 1, NOW(), NOW()),
    (92055, 1, 92010, 92034, 'agent_agent_config_write', '保存人设与配置文件',      3, NULL, NULL, 'agent:agent:config:write',      NULL, 3, 1, 1, NOW(), NOW()),
    (92056, 1, 92010, 92034, 'agent_agent_coord_save',   '保存调度配置',            3, NULL, NULL, 'agent:agent:coordination:save', NULL, 4, 1, 1, NOW(), NOW()),
    -- Worker Catalog（父 92035 /agent/catalog）
    (92057, 1, 92010, 92035, 'agent_catalog_manage',     'Catalog 写回',            3, NULL, NULL, 'agent:catalog:manage',          NULL, 1, 1, 1, NOW(), NOW()),
    -- 会话管理（父 92033 /agent/sessions）
    (92058, 1, 92010, 92033, 'agent_session_delete',     '删除会话（含批量）',      3, NULL, NULL, 'agent:session:delete',          NULL, 1, 1, 1, NOW(), NOW()),
    -- MCP 管理（父 92039 /agent/mcp）
    (92059, 1, 92010, 92039, 'agent_mcp_manage',         'MCP 新增/连接/断开/发现',  3, NULL, NULL, 'agent:mcp:manage',              NULL, 1, 1, 1, NOW(), NOW()),
    -- ⚠️ 高危：可直接执行任意 MCP 工具（impl-plan §4.3 第 42 行标注），默认不授给普通角色
    (92060, 1, 92010, 92039, 'agent_mcp_call',           '手动调用 MCP 工具（高危）', 3, NULL, NULL, 'agent:mcp:call',               NULL, 2, 1, 1, NOW(), NOW()),
    -- 企微机器人（父 92040 /agent/channels/wecom）
    (92061, 1, 92010, 92040, 'agent_wecom_manage',       'Bot 增删改与启停',        3, NULL, NULL, 'agent:wecom:manage',            NULL, 1, 1, 1, NOW(), NOW()),
    -- 系统监控（父 92041 /agent/monitor）
    (92062, 1, 92010, 92041, 'agent_monitor_operate',    '运维动作（failover 重置）', 3, NULL, NULL, 'agent:monitor:operate',        NULL, 1, 1, 1, NOW(), NOW()),
    -- 审批中心（父 92042 /agent/approvals）
    (92063, 1, 92010, 92042, 'agent_approval_handle',    '审批通过/驳回',           3, NULL, NULL, 'agent:approval:handle',         NULL, 1, 1, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = v.id)
  AND EXISTS (SELECT 1 FROM sys_app WHERE id = 92010);


-- ---------------------------------------------------------------------------
-- 2. sys_api —— catalog 根节点 + 58 条接口行（impl-plan §4.3 全映射表 1:1）
--
--    注册表查询 SysApiRepository.findRegistryRows() 的过滤条件：
--      a.type='api' AND a.status=1 AND a.http_method IS NOT NULL
--      AND a.path_pattern IS NOT NULL AND m.status=1
--    且 a.module_id 必须 JOIN 得上 sys_module（V8 加了 FK fk_api_module，
--    指向不存在的模块会直接报错）⇒ 这里引用 V19 建的 92020。
--
--    【path_pattern 写法】ApiPermissionRegistry.java:20 用的是 Spring AntPathMatcher，
--    支持 `{var}` URI 模板占位。故路径直接抄 §4.3 原文的 `{id}` / `{name}` / `{botId}`，
--    不需要改写成 `*`。match() 前会 normalizePath()：去掉 query string、去掉结尾 `/`。
--
--    【两处刻意保留的同权限重叠 —— 不是 bug】
--      * GET /skills/stats            与 GET /skills/{id}
--      * GET /mcp/servers/health      与 GET /mcp/servers/{name}
--      AntPathMatcher 下 `{id}` 也能匹配字面量 `stats`，两条规则会同时命中。
--      ApiPermissionRegistry.match() :81-82 对多命中取 permission **并集且任一即可**，
--      而这两组的 permission 完全相同（agent:skill:list / agent:mcp:list），
--      并集 = 单条，判权强度不被稀释，故无需拆分或调整顺序。
--      反之，任何「宽松码的宽匹配规则」盖住「高危码的窄规则」都是真漏洞 —— 本表已核对：
--      agent:mcp:call 的 POST /mcp/servers/{name}/call 末段是字面量 `call`，
--      与 connect/disconnect/discover 互不覆盖，也不被 POST /mcp/servers（少两段）覆盖。
--
--    【uk_api_method_path 去重】V1:290 的部分唯一索引 (http_method, path_pattern)
--    WHERE type='api' AND status=1。下方 58 行的 (method, path) 两两不重（自检 2 可验），
--    且每行都带相关子查询去重，重复执行安全。
-- ---------------------------------------------------------------------------

-- 2.1 catalog 根节点（type='catalog'，不参与判权，仅提供树形父节点）
--     code 取 '0092' 与 App/模块的 92 段呼应；V17 的 KB 用的是 '0090'，两者同在
--     各自 module 下，uk_api_module_code(module_id, code) 互不影响。
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (92090, 92020, 0, '0092', 'catalog'::sys_api_node_type, '智能体运营 API', NULL::VARCHAR, NULL::VARCHAR, 92, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api WHERE module_id = 92020 AND code = v.code)
  AND EXISTS (SELECT 1 FROM sys_module WHERE id = 92020);

-- 2.2 接口行（type='api'）58 条。序号列 = impl-plan §4.3 表格行号，便于逐条比对。
--     ⚠️ 列清单**没有** tenant_id / app_id —— V8 已 DROP（见文件头 D5）。
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    -- §4.3 #1–#12 技能池 / 技能权限
    (92100, 92020, 92090, '00920001', 'api'::sys_api_node_type, '技能列表',            'GET',    '/api/v1/agent-ops/skills',                              1,  1, NOW(), NOW()),
    (92101, 92020, 92090, '00920002', 'api', '技能统计',            'GET',    '/api/v1/agent-ops/skills/stats',                        2,  1, NOW(), NOW()),
    (92102, 92020, 92090, '00920003', 'api', '技能详情',            'GET',    '/api/v1/agent-ops/skills/{id}',                         3,  1, NOW(), NOW()),
    (92103, 92020, 92090, '00920004', 'api', '新建技能',            'POST',   '/api/v1/agent-ops/skills',                              4,  1, NOW(), NOW()),
    (92104, 92020, 92090, '00920005', 'api', '编辑技能',            'PUT',    '/api/v1/agent-ops/skills/{id}',                         5,  1, NOW(), NOW()),
    (92105, 92020, 92090, '00920006', 'api', '删除技能',            'DELETE', '/api/v1/agent-ops/skills/{id}',                         6,  1, NOW(), NOW()),
    (92106, 92020, 92090, '00920007', 'api', '启用技能',            'POST',   '/api/v1/agent-ops/skills/{id}/enable',                  7,  1, NOW(), NOW()),
    (92107, 92020, 92090, '00920008', 'api', '停用技能',            'POST',   '/api/v1/agent-ops/skills/{id}/disable',                 8,  1, NOW(), NOW()),
    (92108, 92020, 92090, '00920009', 'api', '重建技能索引',        'POST',   '/api/v1/agent-ops/skills/reindex',                      9,  1, NOW(), NOW()),
    (92109, 92020, 92090, '00920010', 'api', '查询技能授权',        'GET',    '/api/v1/agent-ops/skills/{id}/grants',                  10, 1, NOW(), NOW()),
    (92110, 92020, 92090, '00920011', 'api', '保存技能授权',        'PUT',    '/api/v1/agent-ops/skills/{id}/grants',                  11, 1, NOW(), NOW()),
    (92111, 92020, 92090, '00920012', 'api', '角色列表（授权选择用）', 'GET',  '/api/v1/agent-ops/roles',                               12, 1, NOW(), NOW()),

    -- §4.3 #13–#26 Agent 总览与三个详情子页
    (92112, 92020, 92090, '00920013', 'api', 'Agent 列表',          'GET',    '/api/v1/agent-ops/agents',                              13, 1, NOW(), NOW()),
    (92113, 92020, 92090, '00920014', 'api', 'Agent 详情',          'GET',    '/api/v1/agent-ops/agents/{id}',                         14, 1, NOW(), NOW()),
    (92114, 92020, 92090, '00920015', 'api', '启动 Agent',          'POST',   '/api/v1/agent-ops/agents/{id}/start',                   15, 1, NOW(), NOW()),
    (92115, 92020, 92090, '00920016', 'api', '暂停 Agent',          'POST',   '/api/v1/agent-ops/agents/{id}/pause',                   16, 1, NOW(), NOW()),
    (92116, 92020, 92090, '00920017', 'api', '恢复 Agent',          'POST',   '/api/v1/agent-ops/agents/{id}/resume',                  17, 1, NOW(), NOW()),
    (92117, 92020, 92090, '00920018', 'api', '停止 Agent',          'POST',   '/api/v1/agent-ops/agents/{id}/stop',                    18, 1, NOW(), NOW()),
    (92118, 92020, 92090, '00920019', 'api', 'Agent 健康',          'GET',    '/api/v1/agent-ops/agents/{id}/health',                  19, 1, NOW(), NOW()),
    (92119, 92020, 92090, '00920020', 'api', 'Agent 可用技能',      'GET',    '/api/v1/agent-ops/agents/{id}/skills',                  20, 1, NOW(), NOW()),
    (92120, 92020, 92090, '00920021', 'api', '保存 Agent 技能绑定',  'PUT',    '/api/v1/agent-ops/agents/{id}/skills',                  21, 1, NOW(), NOW()),
    (92121, 92020, 92090, '00920022', 'api', '配置文件树',          'GET',    '/api/v1/agent-ops/agents/{id}/config-files',            22, 1, NOW(), NOW()),
    (92122, 92020, 92090, '00920023', 'api', '读取配置文件内容',    'GET',    '/api/v1/agent-ops/agents/{id}/config-files/content',    23, 1, NOW(), NOW()),
    (92123, 92020, 92090, '00920024', 'api', '保存配置文件内容',    'PUT',    '/api/v1/agent-ops/agents/{id}/config-files/content',    24, 1, NOW(), NOW()),
    (92124, 92020, 92090, '00920025', 'api', '读取调度配置',        'GET',    '/api/v1/agent-ops/agents/{id}/coordination',            25, 1, NOW(), NOW()),
    (92125, 92020, 92090, '00920026', 'api', '保存调度配置',        'PUT',    '/api/v1/agent-ops/agents/{id}/coordination',            26, 1, NOW(), NOW()),

    -- §4.3 #27–#33 会话管理 / 本地对话
    (92126, 92020, 92090, '00920027', 'api', '会话列表',            'GET',    '/api/v1/agent-ops/sessions',                            27, 1, NOW(), NOW()),
    (92127, 92020, 92090, '00920028', 'api', '会话详情',            'GET',    '/api/v1/agent-ops/sessions/{id}',                       28, 1, NOW(), NOW()),
    (92128, 92020, 92090, '00920029', 'api', '会话消息',            'GET',    '/api/v1/agent-ops/sessions/{id}/messages',              29, 1, NOW(), NOW()),
    (92129, 92020, 92090, '00920030', 'api', '删除会话',            'DELETE', '/api/v1/agent-ops/sessions/{id}',                       30, 1, NOW(), NOW()),
    (92130, 92020, 92090, '00920031', 'api', '批量删除会话',        'POST',   '/api/v1/agent-ops/sessions/batch-delete',               31, 1, NOW(), NOW()),
    (92131, 92020, 92090, '00920032', 'api', '新建对话会话',        'POST',   '/api/v1/agent-ops/chat/sessions',                       32, 1, NOW(), NOW()),
    (92132, 92020, 92090, '00920033', 'api', '发送对话消息',        'POST',   '/api/v1/agent-ops/chat/sessions/{id}/messages',         33, 1, NOW(), NOW()),

    -- §4.3 #34–#42 MCP 管理（#42 高危）
    (92133, 92020, 92090, '00920034', 'api', 'MCP 服务器列表',      'GET',    '/api/v1/agent-ops/mcp/servers',                         34, 1, NOW(), NOW()),
    (92134, 92020, 92090, '00920035', 'api', 'MCP 健康',            'GET',    '/api/v1/agent-ops/mcp/servers/health',                  35, 1, NOW(), NOW()),
    (92135, 92020, 92090, '00920036', 'api', 'MCP 服务器详情',      'GET',    '/api/v1/agent-ops/mcp/servers/{name}',                  36, 1, NOW(), NOW()),
    (92136, 92020, 92090, '00920037', 'api', 'MCP 工具列表',        'GET',    '/api/v1/agent-ops/mcp/servers/{name}/tools',            37, 1, NOW(), NOW()),
    (92137, 92020, 92090, '00920038', 'api', '新增 MCP 服务器',     'POST',   '/api/v1/agent-ops/mcp/servers',                         38, 1, NOW(), NOW()),
    (92138, 92020, 92090, '00920039', 'api', '连接 MCP 服务器',     'POST',   '/api/v1/agent-ops/mcp/servers/{name}/connect',          39, 1, NOW(), NOW()),
    (92139, 92020, 92090, '00920040', 'api', '断开 MCP 服务器',     'POST',   '/api/v1/agent-ops/mcp/servers/{name}/disconnect',       40, 1, NOW(), NOW()),
    (92140, 92020, 92090, '00920041', 'api', '发现 MCP 工具',       'POST',   '/api/v1/agent-ops/mcp/servers/{name}/discover',         41, 1, NOW(), NOW()),
    (92141, 92020, 92090, '00920042', 'api', '手动调用 MCP 工具（高危）', 'POST', '/api/v1/agent-ops/mcp/servers/{name}/call',        42, 1, NOW(), NOW()),

    -- §4.3 #43–#47 Worker Catalog / 调度观测
    (92142, 92020, 92090, '00920043', 'api', '读取 Worker Catalog', 'GET',    '/api/v1/agent-ops/catalog',                             43, 1, NOW(), NOW()),
    (92143, 92020, 92090, '00920044', 'api', '写回 Worker Catalog', 'PUT',    '/api/v1/agent-ops/catalog',                             44, 1, NOW(), NOW()),
    (92144, 92020, 92090, '00920045', 'api', '调度链路追踪',        'GET',    '/api/v1/agent-ops/dispatch/traces',                     45, 1, NOW(), NOW()),
    (92145, 92020, 92090, '00920046', 'api', '路由日志',            'GET',    '/api/v1/agent-ops/dispatch/route-logs',                 46, 1, NOW(), NOW()),
    (92146, 92020, 92090, '00920047', 'api', '路由统计',            'GET',    '/api/v1/agent-ops/dispatch/route-stats',                47, 1, NOW(), NOW()),

    -- §4.3 #48–#54 企微机器人
    (92147, 92020, 92090, '00920048', 'api', '企微 Bot 列表',       'GET',    '/api/v1/agent-ops/channels/wecom/bots',                 48, 1, NOW(), NOW()),
    (92148, 92020, 92090, '00920049', 'api', '新增企微 Bot',        'POST',   '/api/v1/agent-ops/channels/wecom/bots',                 49, 1, NOW(), NOW()),
    (92149, 92020, 92090, '00920050', 'api', '编辑企微 Bot',        'PUT',    '/api/v1/agent-ops/channels/wecom/bots/{botId}',         50, 1, NOW(), NOW()),
    (92150, 92020, 92090, '00920051', 'api', '删除企微 Bot',        'DELETE', '/api/v1/agent-ops/channels/wecom/bots/{botId}',         51, 1, NOW(), NOW()),
    (92151, 92020, 92090, '00920052', 'api', '启用企微 Bot',        'POST',   '/api/v1/agent-ops/channels/wecom/bots/{botId}/enable',  52, 1, NOW(), NOW()),
    (92152, 92020, 92090, '00920053', 'api', '停用企微 Bot',        'POST',   '/api/v1/agent-ops/channels/wecom/bots/{botId}/disable', 53, 1, NOW(), NOW()),
    (92153, 92020, 92090, '00920054', 'api', '企微 Bot 健康',       'GET',    '/api/v1/agent-ops/channels/wecom/bots/health',          54, 1, NOW(), NOW()),

    -- §4.3 #55–#58 系统监控 / 审批中心
    (92154, 92020, 92090, '00920055', 'api', '监控总览',            'GET',    '/api/v1/agent-ops/monitor/overview',                    55, 1, NOW(), NOW()),
    (92155, 92020, 92090, '00920056', 'api', '重置 failover',       'POST',   '/api/v1/agent-ops/monitor/failover/reset',              56, 1, NOW(), NOW()),
    (92156, 92020, 92090, '00920057', 'api', '审批列表',            'GET',    '/api/v1/agent-ops/approvals',                           57, 1, NOW(), NOW()),
    (92157, 92020, 92090, '00920058', 'api', '审批通过/驳回',       'POST',   '/api/v1/agent-ops/approvals/{id}/decision',             58, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api a WHERE a.module_id = 92020 AND a.code = v.code)
  AND NOT EXISTS (
    SELECT 1 FROM sys_api a
    WHERE a.type = 'api' AND a.status = 1
      AND a.http_method = v.http_method
      AND a.path_pattern = v.path_pattern
  )
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 92090);


-- ---------------------------------------------------------------------------
-- 3. sys_menu_api —— 接口 ⇄ 菜单 关联，permission 由菜单侧提供
--
--    这一步才是「判权真正生效」的开关：findRegistryRows() 的
--    sys_api ⋈ sys_menu_api ⋈ sys_menu 缺了中间这张表，规则行根本不会进注册表，
--    端点回落到 deny-unmapped=false ⇒ 登录即可调（文件头已述）。
--
--    sys_menu_api.id 与 api_id 取同号（92100–92157），人工比对时一眼对齐。
--    每个 api 只挂 **一个** 菜单（见文件头 D6：库层面已不强制，但这是安全要求）。
--
--    菜单侧 permission 归属一览（左=api_id 段，右=menu_id / permission）：
--      92100-92102 → 92037 agent:skill:list          92103-92107 → 92051 agent:skill:manage
--      92108       → 92052 agent:skill:reindex       92109-92111 → 92038 agent:skill:grant
--      92112,92113,92118 → 92034 agent:agent:list    92114-92117 → 92053 agent:agent:manage
--      92119       → 92043 agent:agent:skills        92120       → 92054 agent:agent:skills:save
--      92121,92122 → 92044 agent:agent:config        92123       → 92055 agent:agent:config:write
--      92124       → 92045 agent:agent:coordination  92125       → 92056 agent:agent:coordination:save
--      92126-92128 → 92033 agent:session:list        92129,92130 → 92058 agent:session:delete
--      92131,92132 → 92032 agent:chat:use            92133-92136 → 92039 agent:mcp:list
--      92137-92140 → 92059 agent:mcp:manage          92141       → 92060 agent:mcp:call ⚠️
--      92142       → 92035 agent:catalog:list        92143       → 92057 agent:catalog:manage
--      92144-92146 → 92036 agent:dispatch:list       92147,92153 → 92040 agent:wecom:list
--      92148-92152 → 92061 agent:wecom:manage        92154       → 92041 agent:monitor:view
--      92155       → 92062 agent:monitor:operate     92156       → 92042 agent:approval:list
--      92157       → 92063 agent:approval:handle
--
--    注意 92119/92121/92122/92124 挂的是 V19 建的 **visible=0** 详情子路由节点
--    （92043/92044/92045）。已核实 findRegistryRows() 的 JOIN sys_menu 只过滤
--    m.status=1，**不过滤 type 也不过滤 visible**，故隐藏节点照常供码。
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (92100, 92037, 92100, 1, NOW()), (92101, 92037, 92101, 2, NOW()), (92102, 92037, 92102, 3, NOW()),
    (92103, 92051, 92103, 1, NOW()), (92104, 92051, 92104, 2, NOW()), (92105, 92051, 92105, 3, NOW()),
    (92106, 92051, 92106, 4, NOW()), (92107, 92051, 92107, 5, NOW()),
    (92108, 92052, 92108, 1, NOW()),
    (92109, 92038, 92109, 1, NOW()), (92110, 92038, 92110, 2, NOW()), (92111, 92038, 92111, 3, NOW()),

    (92112, 92034, 92112, 1, NOW()), (92113, 92034, 92113, 2, NOW()),
    (92114, 92053, 92114, 1, NOW()), (92115, 92053, 92115, 2, NOW()), (92116, 92053, 92116, 3, NOW()),
    (92117, 92053, 92117, 4, NOW()),
    (92118, 92034, 92118, 3, NOW()),
    (92119, 92043, 92119, 1, NOW()),
    (92120, 92054, 92120, 1, NOW()),
    (92121, 92044, 92121, 1, NOW()), (92122, 92044, 92122, 2, NOW()),
    (92123, 92055, 92123, 1, NOW()),
    (92124, 92045, 92124, 1, NOW()),
    (92125, 92056, 92125, 1, NOW()),

    (92126, 92033, 92126, 1, NOW()), (92127, 92033, 92127, 2, NOW()), (92128, 92033, 92128, 3, NOW()),
    (92129, 92058, 92129, 1, NOW()), (92130, 92058, 92130, 2, NOW()),
    (92131, 92032, 92131, 1, NOW()), (92132, 92032, 92132, 2, NOW()),

    (92133, 92039, 92133, 1, NOW()), (92134, 92039, 92134, 2, NOW()), (92135, 92039, 92135, 3, NOW()),
    (92136, 92039, 92136, 4, NOW()),
    (92137, 92059, 92137, 1, NOW()), (92138, 92059, 92138, 2, NOW()), (92139, 92059, 92139, 3, NOW()),
    (92140, 92059, 92140, 4, NOW()),
    (92141, 92060, 92141, 1, NOW()),

    (92142, 92035, 92142, 1, NOW()),
    (92143, 92057, 92143, 1, NOW()),
    (92144, 92036, 92144, 1, NOW()), (92145, 92036, 92145, 2, NOW()), (92146, 92036, 92146, 3, NOW()),

    (92147, 92040, 92147, 1, NOW()),
    (92148, 92061, 92148, 1, NOW()), (92149, 92061, 92149, 2, NOW()), (92150, 92061, 92150, 3, NOW()),
    (92151, 92061, 92151, 4, NOW()), (92152, 92061, 92152, 5, NOW()),
    (92153, 92040, 92153, 2, NOW()),

    (92154, 92041, 92154, 1, NOW()),
    (92155, 92062, 92155, 1, NOW()),
    (92156, 92042, 92156, 1, NOW()),
    (92157, 92063, 92157, 1, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (
    SELECT 1 FROM sys_menu_api ma WHERE ma.menu_id = v.menu_id AND ma.api_id = v.api_id
  )
  AND EXISTS (SELECT 1 FROM sys_menu m  WHERE m.id = v.menu_id)
  AND EXISTS (SELECT 1 FROM sys_api  a  WHERE a.id = v.api_id);


-- ---------------------------------------------------------------------------
-- 4. 授权给内置租户管理员 role_id=1
--
--    V19 第 4 节已按 `WHERE m.app_id = 92010` 批量授过一次，但那时本文件的
--    13 个按钮节点尚未插入（Flyway 严格按版本号顺序执行），所以必须在这里补授。
--    口径完全一致：sys_role_permission.id 复用 sys_menu.id（92051–92063）。
--
--    ⚠️ 高危码 agent:mcp:call（92060）随本次一并授予 role_id=1（内置租户管理员）。
--    这与「管理员本来就能做任何事」一致；面向普通角色时请勿在角色模板里勾选它。
--    若你方安全基线要求管理员也不得默认持有，删掉下方 92060 那一行即可，
--    其余行不受影响（本 INSERT 逐行独立判重）。
--
--    为什么仍只授 role_id=1：同 V19 第 4 节注释（impl-plan §1.6 D11 / §11 Q6）——
--    V2__seed_data.sql 只固化了 role_id=1，运维/客服角色的稳定 id 尚未确定。
-- ---------------------------------------------------------------------------
INSERT INTO sys_role_permission (id, role_id, perm_type, target_id, created_at)
SELECT m.id, 1, 'menu'::sys_perm_type, m.id, NOW()
FROM sys_menu m
WHERE m.id BETWEEN 92051 AND 92063
  AND m.app_id = 92010
  AND m.status = 1
  AND NOT EXISTS (
    SELECT 1 FROM sys_role_permission rp
    WHERE rp.role_id = 1 AND rp.perm_type = 'menu' AND rp.target_id = m.id
  )
ON CONFLICT (id) DO NOTHING;


-- ---------------------------------------------------------------------------
-- 迁移后自检（在你方环境执行 flyway migrate 后手工跑一遍）
--
--   -- 0) uk_menu_app_permission 回归项：agent App 内 permission 不得重复
--   SELECT permission, COUNT(*) FROM sys_menu
--   WHERE app_id = 92010 AND status = 1 AND permission IS NOT NULL
--   GROUP BY permission HAVING COUNT(*) > 1;
--   -- 期望：0 行（V19 的 15 个页面码 + 本文件 13 个按钮码 = 28 个，两两不重）
--
--   -- 1) 各表行数
--   SELECT (SELECT COUNT(*) FROM sys_menu     WHERE id BETWEEN 92051 AND 92063) AS buttons,
--          (SELECT COUNT(*) FROM sys_api      WHERE module_id = 92020 AND type = 'api') AS apis,
--          (SELECT COUNT(*) FROM sys_menu_api WHERE id BETWEEN 92100 AND 92157) AS links;
--   -- 期望：13 | 58 | 58
--
--   -- 2) uk_api_method_path 回归项：本模块内 (method, path) 不得重复
--   SELECT http_method, path_pattern, COUNT(*) FROM sys_api
--   WHERE type = 'api' AND status = 1
--   GROUP BY http_method, path_pattern HAVING COUNT(*) > 1;
--   -- 期望：0 行（含与 V17 的 /api/v1/kb/hit-test 比对，全库范围）
--
--   -- 3) 1 api → 1 menu 安全不变量（库层面已不强制，靠这条自检兜住）
--   SELECT api_id, COUNT(*) FROM sys_menu_api
--   WHERE api_id BETWEEN 92100 AND 92157 GROUP BY api_id HAVING COUNT(*) > 1;
--   -- 期望：0 行
--
--   -- 4) 注册表最终视图：58 条规则每条都应带非空 permission、module_status=1
--   SELECT a.http_method, a.path_pattern, m.permission, sm.status AS module_status
--   FROM sys_api a
--   JOIN sys_menu_api ma ON ma.api_id = a.id
--   JOIN sys_menu m      ON ma.menu_id = m.id
--   JOIN sys_module sm   ON sm.id = a.module_id
--   WHERE a.module_id = 92020 AND a.type = 'api'
--   ORDER BY a.sort;
--   -- 期望：58 行，permission 无 NULL（有 NULL ⇒ 该端点退化为 authOnly = 登录即可调）
--
--   -- 5) 授权行
--   SELECT COUNT(*) FROM sys_role_permission
--   WHERE role_id = 1 AND perm_type = 'menu' AND target_id BETWEEN 92051 AND 92063;
--   -- 期望：13
--
--   -- 6) 行为验收：无 agent:mcp:call 的登录用户
--   --    POST /api/v1/agent-ops/mcp/servers/x/call 期望 403（不是 200 也不是 404）。
--   --    BFF 需重启，或等 mis.api-permission.refresh-interval-seconds(300s) 到期重载注册表。
-- ---------------------------------------------------------------------------
