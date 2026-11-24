-- ===========================================================================
-- V183__spm_coupon_bind_permission_stores.sql
-- 闭店退券菜单连带绑定「查询当前操作员权限内门店」API，并确保相关菜单权限授给超管。
-- 前端用 GET /api/v1/permissions/stores?storeType=CSMD 填充查询/编辑门店下拉。
-- 前置：V180（菜单 96041-96044）、V182（sys_api 1102）。
-- ===========================================================================

-- 1) 闭店退券「查看」菜单连带门店查询 API（1102）
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (96115, 96041, 1102, 2, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE menu_id = v.menu_id AND api_id = v.api_id)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = 96041)
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 1102);

-- 2) 闭店退卡「查看」同样需要权限内门店（与退券一致，避免下拉无数据）
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (96116, 96037, 1102, 2, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE menu_id = v.menu_id AND api_id = v.api_id)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = 96037)
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 1102);

-- 3) 超管补授闭店退券菜单/按钮（幂等；防 V180 未落到角色）
INSERT INTO sys_role_permission (id, role_id, perm_type, target_id, created_at)
SELECT m.id, 1, 'menu'::sys_perm_type, m.id, NOW()
FROM sys_menu m
WHERE m.app_id = 96001
  AND m.status = 1
  AND m.id IN (96030, 96041, 96042, 96043, 96044)
  AND NOT EXISTS (
    SELECT 1 FROM sys_role_permission rp
    WHERE rp.role_id = 1 AND rp.perm_type = 'menu' AND rp.target_id = m.id
  )
ON CONFLICT (id) DO NOTHING;
