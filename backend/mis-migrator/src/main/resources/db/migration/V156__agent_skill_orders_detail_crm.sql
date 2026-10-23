-- =============================================================================
-- V156：技能执行权 — orders-detail.crm（CRM 订单详情）
-- =============================================================================
-- 背景：configs/skills 新增 CRM 技能 orders-detail.crm（单笔/批量头+商品行）。
--       T03 ACL 要求每个 skill_id 有独立执行码 ai:skill:{id}:run（见 V21）。
--
-- 本迁移：
--   1) 在目录 92200 下追加按钮 92205
--   2) 授权给内置租户管理员 role_id=1（与 V21 / V155 口径一致）
-- =============================================================================

INSERT INTO sys_menu (
    id, tenant_id, app_id, parent_id, code, name, type,
    path, component, permission, icon, sort, visible, status,
    created_at, updated_at
)
SELECT v.* FROM (VALUES
    (
        92205::BIGINT, 1, 1, 92200,
        'ai_skill_run_orders_detail_crm',
        '执行技能：CRM 订单详情查询',
        3,
        NULL::VARCHAR, NULL::VARCHAR,
        'ai:skill:orders-detail.crm:run',
        NULL::VARCHAR,
        5, 1, 1,
        NOW(), NOW()
    )
) AS v(
    id, tenant_id, app_id, parent_id, code, name, type,
    path, component, permission, icon, sort, visible, status,
    created_at, updated_at
)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu m WHERE m.app_id = 1 AND m.code = v.code)
  AND NOT EXISTS (
    SELECT 1 FROM sys_menu m
    WHERE m.app_id = 1 AND m.status = 1 AND m.permission = v.permission
  )
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = 92200);

INSERT INTO sys_role_permission (id, role_id, perm_type, target_id, created_at)
SELECT m.id, 1, 'menu'::sys_perm_type, m.id, NOW()
FROM sys_menu m
WHERE m.id = 92205
  AND m.app_id = 1
  AND m.status = 1
  AND NOT EXISTS (
    SELECT 1 FROM sys_role_permission rp
    WHERE rp.role_id = 1 AND rp.perm_type = 'menu' AND rp.target_id = m.id
  );
