-- MIS Platform — 智能体运营控制台（agent）App / 模块 / 菜单种子
-- PostgreSQL 16 | 库名: mis_platform
-- 需求：docs/ai-fusion/agent-ops-console/{prd,spec,ui}.md（v1.4，已锁定）
-- 施工图：docs/ai-fusion/agent-ops-console/impl-plan.md §5.1 ID 段 / §5.2 菜单码 / §7 T01
--
-- 本文件对应 prd.md §9 的 **O1-portal 阶段**：让门户九宫格出现「智能体」卡片、
-- 可进入 /agent/**、侧栏按 permission 显隐。真实业务能力在 T02–T05 补。
--
-- ---------------------------------------------------------------------------
-- 【ID 段】impl-plan §5.1，全仓 grep 确认 92xxx 段无占用
--   92010            sys_app     (code='agent')
--   92020            sys_module  (code='agent')
--   92030            sys_menu    目录「智能体运营」(type=1, permission=NULL)
--   92031–92042      sys_menu    侧栏可见页面节点（12 条，逐条对齐 ui.md §2）
--   92043–92045      sys_menu    Agent 详情子路由节点（3 条，visible=0 隐藏出菜单树）
--   92050–92063      sys_menu    按钮节点（操作码）→ 见 V20，本文件不建
--   92090 / 921xx    sys_api / sys_menu_api → 见 V20，本文件不建
--   92200–92299      system App 下 Skill 执行码 → 见 V21，本文件不建
--
-- ---------------------------------------------------------------------------
-- 【为什么 92043–92045 用 type=2 + visible=0，而不是 type=3 按钮节点】
--   impl-plan §11 Q5 把这一项列为"实施前必须先 \d sys_menu 确认"。已核对
--   V1__init_schema.sql:259 —— sys_menu **确有** `visible SMALLINT NOT NULL DEFAULT 1` 列。
--   两个行为已在代码中逐行核实：
--     * MenuService.routerTree()（mis-system/.../service/MenuService.java:49、71）
--       动态路由过滤 `visible = 1`，故 visible=0 的节点**不会**出现在侧栏 —— 正是
--       ui.md §2.2「详情子路由，可无独立菜单」的要求；
--     * MenuService.permissionCodes()（同文件 :78-88）走 findByIdInAndStatus → getPermission，
--       **不过滤 type 也不过滤 visible**，故 agent:agent:skills|config|coordination
--       三个码照常进入用户权限码集合，可被前端 PermissionGate 与
--       ApiPermissionInterceptor（经 V20 的 sys_menu_api）正常使用。
--   选 type=2 而非 type=3 的理由：这三条是**真实路由**（/agent/agents/:id/skills 等），
--   语义上是页面不是按钮；且 type=2 保留了 path 字段，菜单管理后台里可读性更好。
--
-- ---------------------------------------------------------------------------
-- 【必须规避的唯一索引（V1__init_schema.sql 原文核对）】
--   * uk_menu_app_permission (V1:269)  UNIQUE (app_id, permission) WHERE status=1 AND permission IS NOT NULL
--       ⇒ 同一 App 内 permission 两两不重。本文件 15 个码 + V20 的 13 个码 = 28 个，
--         已在文末「自检 SQL 0)」给出可执行的重复检测。V17 的 r1 就是栽在这条上。
--   * uk_menu_app_code       (V1:265)  UNIQUE (app_id, code)
--       ⇒ 同一 App 内 menu.code 两两不重。本文件用 `agent-xxx` 短横线风格，与 V13 一致。
--   * uk_app_tenant_code     (V1)      UNIQUE (tenant_id, code) on sys_app
--   * uk_module_code / uk_module_service on sys_module
--       ⇒ service_name 全局唯一。已 grep 现有取值（mis-system/mis-user/mis-org/mis-rbac/
--         mis-audit/mis-kb/mis-admin-bff），'ai-platform' 未被占用。
--
-- 幂等：固定 ID + `WHERE NOT EXISTS(id)` + 父行存在性检查，可重复执行（impl-plan §10.4 约定 14）。
-- 约束：append-only，不得修改已发布的 V1–V18。
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. 应用（sys_app）：智能体
--
--    portal_group 取 'platform'（协同与平台）：portal-page.tsx:32 的 GROUP_LABEL 与
--    FILTERS 只认 governance / operations / platform 三个 key，KB 当年用的 'knowledge'
--    不在筛选页签里、只能在「全部」下看到。新 App 沿用已知 key，门户筛选可用。
--
--    base_path '/agent' 与前端 lib/nav/host-apps.ts 的 HOST_APP_LANDING 兜底一致；
--    真正落地路由是 '/agent/overview'（host-apps.ts 显式登记，优先于 base_path）。
--
--    ⚠️ 仅插这一行**不足以**让卡片可点击：AppController.ENTERABLE_CODES 是 Java 硬编码
--    常量（impl-plan §1.2 B7），必须同步加 "agent" 并重新部署 BFF。
-- ---------------------------------------------------------------------------
INSERT INTO sys_app (id, tenant_id, code, name, icon, base_path, mfe_remote, sort, status,
                     kind, runtime, description, portal_group, created_at, updated_at)
SELECT v.* FROM (VALUES
    (92010, 1, 'agent', '智能体', 'Bot', '/agent', NULL::VARCHAR, 11, 1,
     'subsystem', 'host', '智能体运营控制台：技能池、会话、调度与渠道', 'platform', NOW(), NOW())
) AS v(id, tenant_id, code, name, icon, base_path, mfe_remote, sort, status,
       kind, runtime, description, portal_group, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_app WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_app WHERE tenant_id = 1 AND code = 'agent');


-- ---------------------------------------------------------------------------
-- 2. 模块（sys_module）：agent → ai-platform 运行时
--
--    sys_api 自 V8 起归属模块（FK fk_api_module → sys_module.id），V20 的 92090/921xx
--    全部挂在本模块下，故这行必须先于 V20 存在。
--    service_name 取 'ai-platform'：运营 API 的最终提供方是 ai-platform（BFF 只是透传），
--    与 sys_module.status 停用即整模块 API 拒绝的语义（ApiPermissionRegistry.match 的
--    moduleStatus 分支）对齐。
-- ---------------------------------------------------------------------------
INSERT INTO sys_module (id, code, name, service_name, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (92020, 'agent', '智能体运营', 'ai-platform', 11, 1, NOW(), NOW())
) AS v(id, code, name, service_name, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_module WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_module WHERE code = 'agent')
  AND NOT EXISTS (SELECT 1 FROM sys_module WHERE service_name = 'ai-platform');


-- ---------------------------------------------------------------------------
-- 3. 菜单（sys_menu）：目录 + 12 个侧栏页面 + 3 个隐藏详情子路由
--
--    ⚠️【四处同步】impl-plan §10.1 约定 2：新增/删除一条 /agent/** 路由，必须同时改
--      ① frontend/src/lib/nav/agent-nav.ts（静态权威叶子清单）
--      ② frontend/src/components/layout/keep-alive-outlet.tsx 的 PAGE_MAP / DYNAMIC_PAGES
--      ③ frontend/src/app/router.tsx
--      ④ 本文件（sys_menu 种子）
--    漏一处的表现是「菜单点了没反应」或「页面存在但侧栏不显示」。
--
--    菜单文案与 permission 逐条抄自 **ui.md §2**（该文档已锁定，为唯一权威；
--    impl-plan §5.2 与其一致，如将来出入以 ui.md 为准）：
--      §2.1 对话与会话：概览 / 本地对话 / 会话管理
--      §2.2 智能体与调度：Agent 总览 /（3 条详情子路由）/ Worker Catalog / 调度观测
--      §2.3 技能与工具：技能池 / 技能权限 / MCP 管理
--      §2.4 渠道与运维：企微机器人 / 系统监控 / 审批中心
--
--    icon 取值必须同步登记到前端 lib/nav/icons.ts 的 ICON_MAP，否则 resolveNavIcon
--    静默回退成 LayoutDashboard（图标全变一个样，不报错，很难查）。
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    -- 目录（type=1，permission 必须为 NULL：目录不承载权限码，否则占用一个 uk_menu_app_permission 名额）
    (92030, 1, 92010, 0, 'agent', '智能体运营', 1, '/agent', NULL, NULL, 'Bot', 1, 1, 1, NOW(), NOW()),

    -- ui.md §2.1 对话与会话
    (92031, 1, 92010, 92030, 'agent-overview',    '概览',          2, '/agent/overview',            'agent/overview/index',    'agent:overview:view',    'LayoutDashboard', 1,  1, 1, NOW(), NOW()),
    (92032, 1, 92010, 92030, 'agent-chat',        '本地对话',      2, '/agent/chat',                'agent/chat/index',        'agent:chat:use',         'MessageSquare',   2,  1, 1, NOW(), NOW()),
    (92033, 1, 92010, 92030, 'agent-sessions',    '会话管理',      2, '/agent/sessions',            'agent/sessions/index',    'agent:session:list',     'History',         3,  1, 1, NOW(), NOW()),

    -- ui.md §2.2 智能体与调度
    (92034, 1, 92010, 92030, 'agent-agents',      'Agent 总览',    2, '/agent/agents',              'agent/agents/index',      'agent:agent:list',       'Bot',             4,  1, 1, NOW(), NOW()),
    (92035, 1, 92010, 92030, 'agent-catalog',     'Worker Catalog',2, '/agent/catalog',             'agent/catalog/index',     'agent:catalog:list',     'Boxes',           5,  1, 1, NOW(), NOW()),
    (92036, 1, 92010, 92030, 'agent-dispatch',    '调度观测',      2, '/agent/dispatch',            'agent/dispatch/index',    'agent:dispatch:list',    'Route',           6,  1, 1, NOW(), NOW()),

    -- ui.md §2.3 技能与工具
    (92037, 1, 92010, 92030, 'agent-skills',      '技能池',        2, '/agent/skills',              'agent/skills/index',      'agent:skill:list',       'Sparkles',        7,  1, 1, NOW(), NOW()),
    (92038, 1, 92010, 92030, 'agent-skill-perms', '技能权限',      2, '/agent/skills/permissions',  'agent/skills/perms',      'agent:skill:grant',      'Lock',            8,  1, 1, NOW(), NOW()),
    (92039, 1, 92010, 92030, 'agent-mcp',         'MCP 管理',      2, '/agent/mcp',                 'agent/mcp/index',         'agent:mcp:list',         'Plug',            9,  1, 1, NOW(), NOW()),

    -- ui.md §2.4 渠道与运维
    (92040, 1, 92010, 92030, 'agent-wecom',       '企微机器人',    2, '/agent/channels/wecom',      'agent/channels/wecom',    'agent:wecom:list',       'MessagesSquare',  10, 1, 1, NOW(), NOW()),
    (92041, 1, 92010, 92030, 'agent-monitor',     '系统监控',      2, '/agent/monitor',             'agent/monitor/index',     'agent:monitor:view',     'Activity',        11, 1, 1, NOW(), NOW()),
    (92042, 1, 92010, 92030, 'agent-approvals',   '审批中心',      2, '/agent/approvals',           'agent/approvals/index',   'agent:approval:list',    'ClipboardCheck',  12, 1, 1, NOW(), NOW()),

    -- ui.md §2.2「详情子路由，可无独立菜单」：visible=0 → 不进侧栏，但 permission 照常生效
    -- 父节点取 92034（Agent 总览），与 impl-plan §5.2 一致；路径含 :id 占位，仅作登记用途，
    -- 前端不从 sys_menu.path 生成这三条路由（走 keep-alive-outlet 的 DYNAMIC_PAGES 前缀匹配）。
    (92043, 1, 92010, 92034, 'agent-detail-skills',  '可用技能',   2, '/agent/agents/:id/skills',       'agent/agents/skills',       'agent:agent:skills',       'Sparkles', 1, 0, 1, NOW(), NOW()),
    (92044, 1, 92010, 92034, 'agent-detail-config',  '人设与配置', 2, '/agent/agents/:id/config',       'agent/agents/config',       'agent:agent:config',       'FileText', 2, 0, 1, NOW(), NOW()),
    (92045, 1, 92010, 92034, 'agent-detail-coord',   '调度配置',   2, '/agent/agents/:id/coordination', 'agent/agents/coordination', 'agent:agent:coordination', 'Network',  3, 0, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = v.id)
  AND EXISTS (SELECT 1 FROM sys_app WHERE id = 92010);


-- ---------------------------------------------------------------------------
-- 4. 授权给内置租户管理员 role_id=1
--
--    口径与 V14__kb_menu_buttons_and_grants.sql B 段、V17 C 段完全一致：
--    sys_role_permission.id 直接复用 sys_menu.id（92030–92045），92xxx 段全仓无占用。
--
--    【为什么只授 role_id=1】impl-plan §1.6 D11 / §11 Q6：V2__seed_data.sql 只固化了
--    内置租户管理员 role_id=1，运维/客服等角色的稳定 role_id 尚未确定。凭空写死 id
--    会在角色体系落定后造成错授/漏授，风险高于收益。上线后由管理员在
--    /system/role 页面自助授权；若产品给出「角色×权限矩阵」，再另出迁移补授。
-- ---------------------------------------------------------------------------
INSERT INTO sys_role_permission (id, role_id, perm_type, target_id, created_at)
SELECT m.id, 1, 'menu'::sys_perm_type, m.id, NOW()
FROM sys_menu m
WHERE m.app_id = 92010
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
--   -- 期望：0 行（V19 跑完 15 个码；V19+V20 跑完 28 个码，仍应 0 行）
--
--   -- 1) 菜单结构与排序
--   SELECT id, name, type, path, permission, visible, sort FROM sys_menu
--   WHERE app_id = 92010 ORDER BY parent_id, sort;
--   -- 期望：目录 92030 + 12 条 visible=1 页面（sort 1..12）+ 3 条 visible=0 详情子路由
--
--   -- 2) 门户可见性（还需 BFF 侧 ENTERABLE_CODES 含 'agent' 且已重启）
--   SELECT id, code, name, runtime, status, portal_group FROM sys_app WHERE code = 'agent';
--   -- 期望：92010 | agent | 智能体 | host | 1 | platform
--
--   -- 3) 授权行
--   SELECT COUNT(*) FROM sys_role_permission
--   WHERE role_id = 1 AND perm_type = 'menu' AND target_id BETWEEN 92030 AND 92045;
--   -- 期望：16
--
--   -- 4) 行为验收：role_id=1 用户登录 agent App 后 GET /api/v1/menus/router
--   --    期望侧栏返回 12 条（visible=0 的 92043–92045 不出现），
--   --    且 /api/v1/menus/permissions 含全部 15 个 agent:* 码。
-- ---------------------------------------------------------------------------
