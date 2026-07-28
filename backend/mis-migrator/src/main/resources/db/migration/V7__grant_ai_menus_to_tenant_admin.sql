-- V6 追加了 AI 菜单/API，但未把菜单授权给 TENANT_ADMIN（role_id=1）。
-- V2 的「绑定全部菜单」只覆盖当时已有菜单，故此处补齐。

INSERT INTO sys_role_permission (id, role_id, perm_type, target_id, created_at)
SELECT m.id, 1, 'menu'::sys_perm_type, m.id, NOW()
FROM sys_menu m
WHERE m.app_id = 1
  AND m.status = 1
  AND m.id BETWEEN 600 AND 615
  AND NOT EXISTS (
      SELECT 1 FROM sys_role_permission rp
      WHERE rp.role_id = 1 AND rp.perm_type = 'menu' AND rp.target_id = m.id
  );
