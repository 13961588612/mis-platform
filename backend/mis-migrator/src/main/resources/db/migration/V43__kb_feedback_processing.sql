-- ===========================================================================
-- V43__kb_feedback_processing.sql
--   增量：KB 问答反馈处理状态（轻量闭环）+ Agent 会话反馈运营四端点登记
--   设计：docs/design/kb-feedback-operations-design-2026-08-13.md（§3.1/§3.5/§1.3）
--   前置：V42 为当前最新版本；本文件为 V43，Flyway 只追加不修改已发布版本。
--
--   内容：
--   A. kb_qa_feedback 增处理状态五列（feedback_status/handler_id/handler_name/
--      handled_at/handle_note），默认 pending；列定义严格按设计 §3.1。
--   B. sys_api 登记 KB 反馈处理端点（id=91201 / code=00900085 / parent=91174
--      问答运营 catalog，module 91020）。
--   C. sys_api 登记 Agent 反馈四端点（id=92169~92172 / code=00920070~00920073 /
--      parent=92162 会话与对话 catalog，module 92020）。
--   D. sys_menu_api 绑定：KB（91290 / menu=91037 / api=91201）+ Agent
--      （92169~92172 / menu=92046 / api=92169~92172，同号对齐 V20 先例）。
--   E. 新菜单 92046「会话反馈」（parent 92030，path /agent/feedback，
--      permission agent:feedback:view，sort 13 顺延）+ sys_role_permission 授权
--      （复用 V19/V20 先例，授予内置租户管理员 role_id=1）。
--
--   【段位说明 —— 与设计稿 §3.5 的两处修正（工程师核实库内已占段位后调整）】
--     1. KB process 端点 parent 用 91174（问答运营）而非设计稿写的 91172（智能问答）：
--        V36__kb_agent_api_domain_catalogs.sql B.7 已把全部 /api/v1/kb/operations/%
--        端点 reparent 到 91174；91172 是 /api/v1/kb/qa/% 的智能问答 catalog。
--        新端点路径 /api/v1/kb/operations/qa/feedback/... 属运营域，挂 91174 保持
--        树形一致（仅影响管理台接口树展示，不影响判权链路）。
--     2. Agent 段位从 92169/00920070 起（而非设计稿的 92158/00920059）：
--        V29__agent_mcp_tool_permissions.sql 已占 92158/92159 + 00920059/00920060，
--        V36 已占 92160~92168 + 00920061~00920069（catalog 节点），
--        故四端点顺延到 92169~92172 + 00920070~00920073，全部避开已占段位。
--
--   幂等：ADD COLUMN IF NOT EXISTS / 固定 COMMENT；登记段 WHERE NOT EXISTS 三重去重
--   + 父节点存在性校验；可重复执行。约束：不得修改已发布的 V1-V42。
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A. kb_qa_feedback 处理状态五列（设计 §3.1 逐列对齐）
-- ---------------------------------------------------------------------------
ALTER TABLE kb_qa_feedback
    ADD COLUMN IF NOT EXISTS feedback_status VARCHAR(16) NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS handler_id     BIGINT        NULL,
    ADD COLUMN IF NOT EXISTS handler_name   VARCHAR(128)  NULL,
    ADD COLUMN IF NOT EXISTS handled_at     TIMESTAMPTZ   NULL,
    ADD COLUMN IF NOT EXISTS handle_note    VARCHAR(500)  NULL;

COMMENT ON COLUMN kb_qa_feedback.feedback_status IS '反馈处理状态：pending/handled/ignored；默认 pending';
COMMENT ON COLUMN kb_qa_feedback.handler_id    IS '处理人 userId（运营侧标记）';
COMMENT ON COLUMN kb_qa_feedback.handler_name  IS '处理人姓名冗余（BFF 回填，避免运营页再查一次 subject）';
COMMENT ON COLUMN kb_qa_feedback.handled_at    IS '处理时间（UTC）';
COMMENT ON COLUMN kb_qa_feedback.handle_note   IS '处理备注';

-- ---------------------------------------------------------------------------
-- B. sys_api 登记：KB 反馈处理（PATCH /api/v1/kb/operations/qa/feedback/{feedbackId}/process）
--    父节点 91174（问答运营 catalog，V36 已 reparent 全部 /operations/ 端点到此）存在才落。
-- ---------------------------------------------------------------------------
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (91201, 91020, 91174, '00900085', 'api'::sys_api_node_type, '处理问答反馈', 'PATCH', '/api/v1/kb/operations/qa/feedback/{feedbackId}/process', 79, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api WHERE module_id = v.module_id AND code = v.code)
  AND NOT EXISTS (SELECT 1 FROM sys_api a WHERE a.type='api' AND a.status=1
        AND a.http_method = v.http_method AND a.path_pattern = v.path_pattern)
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 91174);

-- ---------------------------------------------------------------------------
-- C. sys_api 登记：Agent 反馈四端点（BFF /api/v1/agent-ops/sessions/feedback*）
--    父节点 92162（会话与对话 catalog，V36 已 reparent 全部 /sessions% 端点到此）。
--    ⚠️ 段位修正：92158~92161/00920059~00920062 已被 V29/V36 占用（见文件头），
--    本文件从 92169~92172 + 00920070~00920073 起。
-- ---------------------------------------------------------------------------
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (92169, 92020, 92162, '00920070', 'api'::sys_api_node_type, 'Agent 反馈列表',          'GET',   '/api/v1/agent-ops/sessions/feedback',                          32, 1, NOW(), NOW()),
    (92170, 92020, 92162, '00920071', 'api'::sys_api_node_type, 'Agent 反馈统计',          'GET',   '/api/v1/agent-ops/sessions/feedback/stats',                    33, 1, NOW(), NOW()),
    (92171, 92020, 92162, '00920072', 'api'::sys_api_node_type, '处理单条 Agent 反馈',     'POST',  '/api/v1/agent-ops/sessions/feedback/{feedbackId}/process',    34, 1, NOW(), NOW()),
    (92172, 92020, 92162, '00920073', 'api'::sys_api_node_type, '批量处理 Agent 反馈',     'POST',  '/api/v1/agent-ops/sessions/feedback/batch-process',           35, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api WHERE module_id = v.module_id AND code = v.code)
  AND NOT EXISTS (SELECT 1 FROM sys_api a WHERE a.type='api' AND a.status=1
        AND a.http_method = v.http_method AND a.path_pattern = v.path_pattern)
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 92162);

-- ---------------------------------------------------------------------------
-- D. sys_menu_api 绑定（权限码由菜单侧提供）
--    D.1 KB：菜单 91037（问答运营，kb:operation:list）→ API 91201
--        （设计 §8 待明确事项 8：process 端点挂「问答运营」菜单，不新增 KB 菜单/权限码）
--        绑定 id=91290（91289 已被 V42 占用）。
--    D.2 Agent：菜单 92046（会话反馈，agent:feedback:view）→ API 92169~92172
--        （sys_menu_api.id 与 api_id 同号，对齐 V20 先例便于人工比对）
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (91290, 91037, 91201, 1, NOW()),
    (92169, 92046, 92169, 1, NOW()),
    (92170, 92046, 92170, 2, NOW()),
    (92171, 92046, 92171, 3, NOW()),
    (92172, 92046, 92172, 4, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE menu_id = v.menu_id AND api_id = v.api_id)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = v.menu_id)
  AND EXISTS (SELECT 1 FROM sys_api  WHERE id = v.api_id);

-- ---------------------------------------------------------------------------
-- E. 新菜单 92046「会话反馈」+ sys_role_permission 授权
--    E.1 菜单：parent 92030（智能体运营目录），type=2 页面，path /agent/feedback，
--        component agent/sessions/feedback（与前端 features/agent/sessions/ 布局对应），
--        permission agent:feedback:view，sort=13（V19 页面 92031~92042 已占 sort 1~12）。
--        icon 用 MessageSquareWarning —— 同步登记到 frontend/src/lib/nav/icons.ts 的 ICON_MAP
--        （V19 文件头「四处同步」约定），否则静默回退 LayoutDashboard。
--    E.2 授权：复用 V19/V20 先例，授予内置租户管理员 role_id=1（perm_type='menu'，
--        target_id=92046）；其余角色由管理员在 /system/role 自助授权。
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (92046, 1, 92010, 92030, 'agent-feedback', '会话反馈', 2, '/agent/feedback', 'agent/sessions/feedback', 'agent:feedback:view', 'MessageSquareWarning', 13, 1, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu WHERE app_id = v.app_id AND code = v.code)
  AND NOT EXISTS (SELECT 1 FROM sys_menu WHERE app_id = v.app_id AND permission = v.permission)
  AND EXISTS (SELECT 1 FROM sys_app WHERE id = 92010)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = 92030);

INSERT INTO sys_role_permission (id, role_id, perm_type, target_id, created_at)
SELECT 92046, 1, 'menu'::sys_perm_type, 92046, NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM sys_role_permission rp
    WHERE rp.role_id = 1 AND rp.perm_type = 'menu' AND rp.target_id = 92046
);

-- ---------------------------------------------------------------------------
-- 迁移后自检（在你方环境执行 flyway migrate 后手工跑一遍）
--
--   -- 0) 新增列
--   SELECT column_name, data_type, column_default FROM information_schema.columns
--   WHERE table_name = 'kb_qa_feedback'
--     AND column_name IN ('feedback_status','handler_id','handler_name','handled_at','handle_note')
--   ORDER BY ordinal_position;
--   -- 期望：5 行，feedback_status 默认 'pending'，其余可空
--
--   -- 1) uk_api_module_code 回归项：module 91020/92020 内 code 不得重复
--   SELECT module_id, code, COUNT(*) FROM sys_api
--   WHERE module_id IN (91020, 92020) GROUP BY module_id, code HAVING COUNT(*) > 1;
--   -- 期望：0 行
--
--   -- 2) uk_api_method_path 回归项：全库 (method, path) 不得重复
--   SELECT http_method, path_pattern, COUNT(*) FROM sys_api
--   WHERE type = 'api' AND status = 1 GROUP BY http_method, path_pattern HAVING COUNT(*) > 1;
--   -- 期望：0 行
--
--   -- 3) 新增行 + 绑定
--   SELECT id, code, http_method, path_pattern, parent_id FROM sys_api
--   WHERE id IN (91201, 92169, 92170, 92171, 92172) ORDER BY id;
--   SELECT id, menu_id, api_id FROM sys_menu_api
--   WHERE id IN (91290, 92169, 92170, 92171, 92172) ORDER BY id;
--   -- 期望：5 行 sys_api + 5 行 sys_menu_api，id 一一对齐
--
--   -- 4) 新菜单 + 授权
--   SELECT id, name, path, permission, sort, visible, status FROM sys_menu WHERE id = 92046;
--   SELECT COUNT(*) FROM sys_role_permission
--   WHERE role_id = 1 AND perm_type = 'menu' AND target_id = 92046;
--   -- 期望：菜单 1 行（visible=1）+ 授权 1 行
-- ---------------------------------------------------------------------------
