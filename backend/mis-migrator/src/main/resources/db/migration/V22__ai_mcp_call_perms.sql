-- MIS Platform — MCP 运行时执行码（ai:mcp:call）
-- PostgreSQL 16 | 库名: mis_platform
-- 施工图：gw-closeout-design.md §3（Q7 方案 B+）/ impl-plan.md §11 Q7
-- 前置：V6__ai_capability_permissions.sql（system App 下的「AI 能力」目录 600）
--
-- ---------------------------------------------------------------------------
-- 【为什么需要独立执行码 ai:mcp:call（Q7 方案 B+）】
--   backend E2 运行时链路（`runtime/acl_tool_wrapper.py:_mcp_requirement`）在技能
--   注册表（`mcp-{server}-{tool}`）未命中时，兜底使用
--   `MIS_ACL_MCP_FALLBACK_PERMISSION`（默认 `agent:mcp:call`）。
--   但 `agent:mcp:call` 是 V20 建的「运营台手动调 MCP」操作码（菜单 92060 /
--   api 92141），被运行时链路复用 = 语义混淆：一旦把该码授给非管理员运营人员，
--   等于同时放开「运行时任意 MCP 工具执行」，属隐式提权面。
--   本迁移新建独立执行码 `ai:mcp:call`（App=system），与运营台操作码解耦；
--   `config.py` 默认值同步改为 `ai:mcp:call`（gw-closeout 收口）。
--
-- ---------------------------------------------------------------------------
-- 【为什么挂 system App（app_id=1）】
--   与 V21 技能执行码（`ai:skill:{id}:run`）同域：运行时执行是**跨端**能力
--   （企微机器人 / Agent 对话都可能触发），不是「智能体运营控制台」的专属功能。
--   角色授权在既有「系统管理 → AI 能力」树下即可勾选。
--   ⚠️ uk_menu_app_permission 作用域是**单个 App**：本文件码全部落在 app_id=1，
--   与 V19/V20 落在 app_id=92010 的 agent:* 码天然不冲突；已 grep 核实
--   app_id=1 下现存无任何 `ai:mcp:*` 码。
--
-- ---------------------------------------------------------------------------
-- 【ID 段 92300–92399（V21 占用 92200–92299 技能码段，本段顺延；已 grep 无占用）】
--   92300  目录「MCP 运行时执行权」（type=1，permission NULL，visible=0）
--   92301  `ai:mcp:call` 按钮节点（type=3，permission='ai:mcp:call'）
--   目录 92300 visible=0 的理由与 V21 目录 92200 完全一致：子节点全是 type=3
--   按钮，侧栏（routerTree 只渲染 type=1|2）不渲染；permissionCodes() 不过滤
--   type/visible，按钮码照常进入用户权限码集合（零侧栏回归）。
--
-- ---------------------------------------------------------------------------
-- 【为什么只授 role_id=1】同 V19/V20/V21：V2__seed_data.sql 只固化了内置租户
--   管理员；运维/客服等角色的稳定 role_id 尚未确定，凭空写死会造成错授/漏授。
--   真实业务里「谁能运行时执行 MCP 工具」应按角色精细分配，由管理员在
--   /system/role 页面自助勾选，而不是迁移里替他们决定。
--
-- 幂等：固定 ID + WHERE NOT EXISTS + 父行存在性检查 + ON CONFLICT DO NOTHING，可重复执行。
-- 约束：append-only，不得修改 V1–V21。
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. 目录节点「MCP 运行时执行权」（type=1，permission=NULL，visible=0）
--
--    permission 必须为 NULL：目录承载权限码会白占一个 uk_menu_app_permission
--    名额，且 MenuService.permissionCodes() 会把它也算进用户码集合，语义混乱。
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (92300, 1, 1, 600, 'ai-mcp-exec', 'MCP 运行时执行权', 1, NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR, 'Zap', 91, 0, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu WHERE app_id = 1 AND code = v.code)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = 600);


-- ---------------------------------------------------------------------------
-- 2. `ai:mcp:call` 执行码按钮节点（type=3）
--
--    permission 格式严格为 `ai:mcp:call`（E2 运行时兜底码，settings
--    MIS_ACL_MCP_FALLBACK_PERMISSION 默认值与此一致）。MCP server 是运行时
--    动态清单（per-Agent YAML + 内存注册），本期不做 server 级 `ai:mcp:{server}:call`
--    （gw-closeout-design §3.2 方案 A 否决：静态 DB 码必然漂移）。
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (92301, 1, 1, 92300, 'ai_mcp_call', '运行时执行任意 MCP 工具（兜底码）', 3, NULL::VARCHAR, NULL::VARCHAR, 'ai:mcp:call', NULL::VARCHAR, 1, 1, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu m WHERE m.app_id = 1 AND m.code = v.code)
  AND NOT EXISTS (
    SELECT 1 FROM sys_menu m
    WHERE m.app_id = 1 AND m.status = 1 AND m.permission = v.permission
  )
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = 92300);


-- ---------------------------------------------------------------------------
-- 3. 授权给内置租户管理员 role_id=1
--
--    口径与 V19 第 4 节 / V20 第 4 节 / V21 第 3 节完全一致：
--    sys_role_permission.id 复用 sys_menu.id（92300–92301）。
--    目录 92300 也一并授权：虽然 permission=NULL、不产生权限码，但角色权限树
--    在前端按父子关系渲染，父节点未授权时子节点在勾选树里挂不上。
-- ---------------------------------------------------------------------------
INSERT INTO sys_role_permission (id, role_id, perm_type, target_id, created_at)
SELECT m.id, 1, 'menu'::sys_perm_type, m.id, NOW()
FROM sys_menu m
WHERE m.id BETWEEN 92300 AND 92399
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
--   -- 1) 执行码存在且格式正确
--   SELECT id, code, name, permission, type, visible FROM sys_menu
--   WHERE id BETWEEN 92300 AND 92399 ORDER BY id;
--   -- 期望：92300 目录(type=1, permission NULL, visible=0)
--   --       92301 ai:mcp:call
--
--   -- 2) 与 V20 操作码解耦：agent:mcp:call（92060）仍在 agent App 下独立存在
--   SELECT id, app_id, permission FROM sys_menu
--   WHERE permission IN ('ai:mcp:call', 'agent:mcp:call') AND status = 1 ORDER BY app_id, id;
--   -- 期望：2 行（app_id=1 的 92301 ai:mcp:call；app_id=92010 的 92060 agent:mcp:call）
--
--   -- 3) 授权行
--   SELECT COUNT(*) FROM sys_role_permission
--   WHERE role_id = 1 AND perm_type = 'menu' AND target_id BETWEEN 92300 AND 92399;
--   -- 期望：2（1 个目录 + 1 个执行码）
--
--   -- 4) 侧栏零回归：system App 动态路由不应因本迁移多出任何节点
--   SELECT COUNT(*) FROM sys_menu WHERE app_id = 1 AND visible = 1 AND status = 1 AND type IN (1, 2);
--   -- 期望：与执行 V22 之前完全相同（92300 是 visible=0，子节点是 type=3）
--
--   -- 5) 行为验收（依赖 backend E2 链路）：
--   --    持有 ai:mcp:call 的用户运行时调用未映射 skill 的 MCP 工具 ⇒ 放行；
--   --    不持有 ⇒ 拒绝（fail-closed，拒绝文案点名的兜底码为 ai:mcp:call）。
-- ---------------------------------------------------------------------------
