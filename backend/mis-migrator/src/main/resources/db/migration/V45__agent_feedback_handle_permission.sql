-- ===========================================================================
-- V45__agent_feedback_handle_permission.sql
--   将会话反馈的「处理 / 批量处理」从页面只读码 agent:feedback:view 拆出独立操作码
--   agent:feedback:handle（对齐设计稿 kb-feedback-operations-design §7 预留，
--   命名同 agent:approval:handle）。
--
--   变更：
--     A. 新按钮菜单 92064（parent=92046 会话反馈，type=3）
--     B. 将 process 两端点 sys_menu_api（92171 / 92172）从页面 92046 改挂到 92064
--        （列表 GET 92169 / 统计 GET 92170 仍挂 92046 → agent:feedback:view）
--     C. 授权 role_id=1（TENANT_ADMIN）新按钮码；其它角色由管理员自助勾选
--
--   前置：V43（菜单 92046 + sys_api 92169~92172）+ V44（menu_api 补偿绑定）
--   约束：append-only；不得修改已发布的 V1–V44。
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A. 按钮节点：处理反馈（含批量）
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (92064, 1, 92010, 92046, 'agent_feedback_handle', '处理反馈（含批量）', 3, NULL, NULL, 'agent:feedback:handle', NULL, 1, 1, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = v.id)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = 92046)
  AND EXISTS (SELECT 1 FROM sys_app WHERE id = 92010);

-- ---------------------------------------------------------------------------
-- B. process 两端点改挂到按钮菜单 92064
--    已存在绑定（V43/V44 挂在 92046）→ UPDATE menu_id
--    若绑定缺失（异常库）→ 幂等 INSERT 到 92064
-- ---------------------------------------------------------------------------
UPDATE sys_menu_api
SET menu_id = 92064,
    sort = CASE api_id WHEN 92171 THEN 1 WHEN 92172 THEN 2 ELSE sort END
WHERE api_id IN (92171, 92172)
  AND menu_id = 92046
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = 92064);

INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (92171, 92064, 92171, 1, NOW()),
    (92172, 92064, 92172, 2, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE api_id = v.api_id)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = v.menu_id)
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = v.api_id);

-- ---------------------------------------------------------------------------
-- C. 授权管理员角色（与 V43 对 92046 的授权同款）
-- ---------------------------------------------------------------------------
INSERT INTO sys_role_permission (id, role_id, perm_type, target_id, created_at)
SELECT 92064, 1, 'menu'::sys_perm_type, 92064, NOW()
WHERE EXISTS (SELECT 1 FROM sys_menu WHERE id = 92064)
  AND NOT EXISTS (
      SELECT 1 FROM sys_role_permission rp
      WHERE rp.role_id = 1 AND rp.perm_type = 'menu' AND rp.target_id = 92064
  );

-- ---------------------------------------------------------------------------
-- 迁移后自检
--   SELECT id, parent_id, name, type, permission FROM sys_menu WHERE id IN (92046, 92064);
--   SELECT id, menu_id, api_id FROM sys_menu_api WHERE api_id IN (92169,92170,92171,92172) ORDER BY id;
--   -- 期望：92169/92170 → menu 92046；92171/92172 → menu 92064
--   SELECT role_id, target_id FROM sys_role_permission
--   WHERE target_id IN (92046, 92064) AND perm_type = 'menu';
-- ---------------------------------------------------------------------------
