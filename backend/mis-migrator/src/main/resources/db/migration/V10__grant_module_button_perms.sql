-- V10：补全「接口模块」按钮权限（system:module:add / edit / delete）对内置角色的授权
--
-- 根因：
--   V8 仅 INSERT 了模块按钮菜单节点（id 271/272/273，type=3，挂在模块菜单 207 下），
--   但未写入 sys_role_permission 授权；V2 的“全量授权”在 V8 *之前* 执行，SELECT 时这些
--   按钮尚不存在，故未覆盖。最终 TENANT_ADMIN(role_id=1) 缺 system:module:edit/delete/add，
--   前端 PermissionGate 把编辑/删除/新增按钮全部隐藏 → “模块管理没有编辑功能”。
-- 修复：
--   将模块按钮（parent_id=207, type=3）授权给内置角色 role_id=1，与 V9 菜单页授权口径一致。
--   防御式写法：NOT EXISTS 去重 + ON CONFLICT(id) DO NOTHING，可重复执行不报错。

INSERT INTO sys_role_permission (id, role_id, perm_type, target_id, created_at)
SELECT m.id, 1, 'menu'::sys_perm_type, m.id, NOW()
FROM sys_menu m
WHERE m.parent_id = 207
  AND m.type = 3
  AND m.status = 1
  AND NOT EXISTS (
    SELECT 1 FROM sys_role_permission rp
    WHERE rp.role_id = 1 AND rp.perm_type = 'menu' AND rp.target_id = m.id
  )
ON CONFLICT (id) DO NOTHING;
