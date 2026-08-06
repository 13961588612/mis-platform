-- MIS Platform — AI 技能执行权（ai:skill:{id}:run）
-- PostgreSQL 16 | 库名: mis_platform
-- 施工图：impl-plan.md §4.2（技能执行判权）/ §5.1 ID 段 / §7 T01 / §11 Q1-b
-- 前置：V6__ai_capability_permissions.sql（system App 下的「AI 能力」目录 600）
--
-- ---------------------------------------------------------------------------
-- 【这些码是给谁用的】
--   不是给 /agent/** 运营控制台用的，而是给**技能执行链路**用的：
--     POST /api/v1/ai/skill/execute  与  POST /api/v1/ai/skill/apply
--   BFF 侧 security/SkillPermissionChecker.assertCanRun(LoginUser, skillId) 会拿
--   请求体里的 skill_id 拼出 `ai:skill:{skill_id}:run`，在登录态权限码集合里查；
--   查不到即抛 BusinessException(AI_SKILL_FORBIDDEN)（主理人决策 ③：**fail-closed**，
--   码不存在时拒绝而非放行）。数据源与 ApiPermissionInterceptor 是同一份权限码集合，
--   而该集合来自 MenuService.permissionCodes() ⇒ 码必须以 sys_menu 行的形式存在。
--   本文件就是把这些行建出来。
--
-- ---------------------------------------------------------------------------
-- 【为什么挂在 system App（app_id=1）而不是 agent App（92010）】
--   技能执行是**跨端**能力：MIS 各业务页、企微机器人、Agent 对话都可能触发，
--   不是「智能体运营控制台」这一个 App 的专属功能。挂 system App 的好处是
--   角色授权时在既有「系统管理 → AI 能力」树下就能勾选，运营不必先进 agent App。
--   父节点取 V6 建的目录 600（'AI 能力'），层级语义连贯。
--
--   ⚠️ uk_menu_app_permission 是 (app_id, permission) WHERE status=1 AND permission
--   IS NOT NULL 的部分唯一索引，作用域是**单个 App**。本文件的码全部落在 app_id=1，
--   与 V19/V20 落在 app_id=92010 的 28 个 agent:* 码天然不冲突。
--   已 grep 确认 app_id=1 下现存无任何 `ai:skill:*` 码（V6 只有 ai:summary:use /
--   ai:extract:use / ai:rag:use / ai:chat:use）。
--
-- ---------------------------------------------------------------------------
-- 【目录 92200 为什么 visible=0】
--   它的子节点全是 type=3 按钮，侧栏（MenuService.routerTree 只渲染 type=1|2）
--   渲染出来会是一个点开永远空的目录。置 visible=0 后：
--     * routerTree 过滤 visible=1 ⇒ 系统侧栏外观完全不变（零回归）；
--     * permissionCodes() 走 findByIdInAndStatus → getPermission，
--       **不过滤 type 也不过滤 visible** ⇒ 三个 run 码照常进入用户权限码集合。
--   （V6 的目录 600 是 visible=1 且子节点也全是按钮，已存在同类空目录；
--     本文件不去修它 —— append-only，且那是既有行为，不在 T01 范围。）
--
-- ---------------------------------------------------------------------------
-- 【Skill 清单来源】agent/ai-platform/configs/skills/registry.yaml（本次实读，v1.0.0）
--     member.profile          crm/member-profile          会员档案查询        status=active
--     member.points-account   crm/member-points-account   会员积分账户查询    status=active
--     member.coupons-account  crm/member-coupon-account   会员券账户与流水查询 status=active
--   三条均为 active，故三条都建码。**不是占位数据。**
--
--   【新增 Skill 怎么办 —— impl-plan §11 Q1-b 口径】
--   registry.yaml 是可以随时增删的运行时配置，而权限码是 DB 行，二者会漂移。
--   长期方案是 BFF 启动时（或技能重建索引时）按 registry 差量 upsert 这些按钮节点，
--   即"动态注册"；在那之前，**每新增一个 Skill 必须补一版迁移**，
--   否则该 Skill 因 fail-closed 对所有人（含管理员）都不可执行。
--   ID 段 92200–92299 已为此预留，够 99 个 Skill；按 92204、92205… 顺延即可。
--
-- ---------------------------------------------------------------------------
-- 【本文件刻意不做的事：/api/v1/ai/skill/execute|apply 的 sys_api 登记】
--   impl-plan §4.3 表外附注 #59/#60 指出这两个端点当前未登记 sys_api，
--   等同"登录即可调"。本文件**没有**补登记，原因是它解决不了问题、还会添乱：
--     * 这两个端点的真实鉴权粒度是 **body 里的 skill_id**，不是 URL。
--       在 sys_api 上挂任何单一 permission（例如 ai:skill:execute）都只能表达
--       "能不能调这个端点"，无法表达"能不能跑这个技能" —— 而后者才是需求。
--     * 真正的门是 SkillPermissionChecker（fail-closed），它属于 **T02 BFF 批次**。
--       本文件提供的是它所依赖的**数据基础**（码必须先存在，否则 T02 上线当天
--       所有技能对所有人 403）。
--   ⇒ 结论：#59/#60 的登记与 SkillPermissionChecker 一起在 T02 落地，
--     本文件先把码铺好。T01 阶段这两个端点维持现状（登录即可调），
--     这是**既有状态、非本次引入的回归**。已在交付报告中列为未决项。
--
-- 幂等：固定 ID + WHERE NOT EXISTS + 父行存在性检查 + ON CONFLICT DO NOTHING，可重复执行。
-- 约束：append-only，不得修改 V1–V20。
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. 目录节点「AI 技能执行权」（type=1，permission=NULL，visible=0）
--
--    permission 必须为 NULL：目录承载权限码会白占一个 uk_menu_app_permission 名额，
--    且 MenuService.permissionCodes() 会把它也算进用户码集合，语义混乱。
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (92200, 1, 1, 600, 'ai-skill-exec', 'AI 技能执行权', 1, NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR, 'ShieldCheck', 90, 0, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu WHERE app_id = 1 AND code = v.code)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = 600);


-- ---------------------------------------------------------------------------
-- 2. 每个 Skill 一个执行码按钮节点（type=3）
--
--    permission 格式严格为 `ai:skill:{skill_id}:run`，其中 {skill_id} 是
--    registry.yaml 里的原始 id（**含点号**，如 member.profile）—— 不要做任何
--    转义或改写，因为 SkillPermissionChecker 是拿请求体里的 skill_id 原样拼串比对，
--    这里写成 member_profile 就永远匹配不上。
--
--    menu.code 则不能带点号风格混用，统一用下划线 slug（uk_menu_app_code 只要求唯一，
--    带点号技术上也能存，但与 app_id=1 下既有的 module_add / ai 等命名风格不一致）。
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (92201, 1, 1, 92200, 'ai_skill_run_member_profile',         '执行技能：会员档案查询',         3, NULL::VARCHAR, NULL::VARCHAR, 'ai:skill:member.profile:run',         NULL::VARCHAR, 1, 1, 1, NOW(), NOW()),
    (92202, 1, 1, 92200, 'ai_skill_run_member_points_account',  '执行技能：会员积分账户查询',     3, NULL,          NULL,          'ai:skill:member.points-account:run',  NULL,          2, 1, 1, NOW(), NOW()),
    (92203, 1, 1, 92200, 'ai_skill_run_member_coupons_account', '执行技能：会员券账户与流水查询', 3, NULL,          NULL,          'ai:skill:member.coupons-account:run', NULL,          3, 1, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu m WHERE m.app_id = 1 AND m.code = v.code)
  AND NOT EXISTS (
    SELECT 1 FROM sys_menu m
    WHERE m.app_id = 1 AND m.status = 1 AND m.permission = v.permission
  )
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = 92200);


-- ---------------------------------------------------------------------------
-- 3. 授权给内置租户管理员 role_id=1
--
--    口径与 V19 第 4 节 / V20 第 4 节完全一致：sys_role_permission.id 复用
--    sys_menu.id（92200–92203）。92xxx 段全仓无占用（已 grep 核实）。
--
--    目录 92200 也一并授权：虽然它 permission=NULL、不产生权限码，但角色权限树
--    在前端是按父子关系渲染的，父节点未授权时子节点在勾选树里会挂不上。
--    这与 V19 第 4 节「按 app_id 批量授含目录 92030」的做法一致。
--
--    【为什么只授 role_id=1】同 V19/V20：V2__seed_data.sql 只固化了内置租户管理员，
--    运维/客服等角色的稳定 role_id 尚未确定，凭空写死会造成错授/漏授。
--    真实业务里「谁能跑哪个技能」恰恰是要按角色精细分配的，更应由管理员在
--    /system/role 页面自助勾选，而不是迁移里替他们决定。
-- ---------------------------------------------------------------------------
INSERT INTO sys_role_permission (id, role_id, perm_type, target_id, created_at)
SELECT m.id, 1, 'menu'::sys_perm_type, m.id, NOW()
FROM sys_menu m
WHERE m.id BETWEEN 92200 AND 92299
  AND m.app_id = 1
  AND m.status = 1
  AND NOT EXISTS (
    SELECT 1 FROM sys_role_permission rp
    WHERE rp.role_id = 1 AND rp.perm_type = 'menu' AND rp.target_id = m.id
  )
ON CONFLICT (id) DO NOTHING;


-- ---------------------------------------------------------------------------
-- 迁移后自检（在你方环境执行 flyway migrate 后手工跑一遍）
--
--   -- 0) uk_menu_app_permission 回归项：system App 内 permission 不得重复
--   SELECT permission, COUNT(*) FROM sys_menu
--   WHERE app_id = 1 AND status = 1 AND permission IS NOT NULL
--   GROUP BY permission HAVING COUNT(*) > 1;
--   -- 期望：0 行
--
--   -- 1) 三个执行码存在且格式正确（注意 skill_id 里的点号必须原样保留）
--   SELECT id, code, name, permission, type, visible FROM sys_menu
--   WHERE id BETWEEN 92200 AND 92299 ORDER BY id;
--   -- 期望：92200 目录(type=1, permission NULL, visible=0)
--   --       92201 ai:skill:member.profile:run
--   --       92202 ai:skill:member.points-account:run
--   --       92203 ai:skill:member.coupons-account:run
--
--   -- 2) 与 registry.yaml 对账：DB 里的码集合必须等于 registry 中 status=active 的 skill 集合
--   SELECT REPLACE(REPLACE(permission, 'ai:skill:', ''), ':run', '') AS skill_id
--   FROM sys_menu WHERE app_id = 1 AND permission LIKE 'ai:skill:%:run' AND status = 1
--   ORDER BY 1;
--   -- 期望：member.coupons-account / member.points-account / member.profile
--   -- 少一条 ⇒ 该技能对所有人 403（fail-closed）；多一条 ⇒ 有已下线技能的残留码
--
--   -- 3) 授权行
--   SELECT COUNT(*) FROM sys_role_permission
--   WHERE role_id = 1 AND perm_type = 'menu' AND target_id BETWEEN 92200 AND 92299;
--   -- 期望：4（1 个目录 + 3 个技能码）
--
--   -- 4) 侧栏零回归：system App 动态路由不应因本迁移多出任何节点
--   SELECT COUNT(*) FROM sys_menu WHERE app_id = 1 AND visible = 1 AND status = 1 AND type IN (1, 2);
--   -- 期望：与执行 V21 之前完全相同（92200 是 visible=0，子节点是 type=3）
--
--   -- 5) 行为验收（依赖 T02 的 SkillPermissionChecker，T01 阶段尚不可验）：
--   --    持有 ai:skill:member.profile:run 的用户 POST /api/v1/ai/skill/execute
--   --      body {"skill_id":"member.profile", ...} 期望 200；
--   --    不持有的用户期望 403 AI_SKILL_FORBIDDEN（fail-closed，主理人决策 ③）。
-- ---------------------------------------------------------------------------
