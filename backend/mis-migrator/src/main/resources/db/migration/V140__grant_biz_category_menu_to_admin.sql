-- V140__grant_biz_category_menu_to_admin.sql
-- 授权「业务分类」菜单 95012 给内置租户管理员 role_id=1 | PostgreSQL 16 | 幂等
--
-- ## 背景（对齐 docs/design/portal-matters-aggregation-design.md §6.2）
--   V139 已登记「业务分类」菜单 95012（权限点 biz:category:list）与其 6 个端点
--   95093-95098，但**未**把该菜单授权给 role_id=1。前端 `PermissionGate`
--   依赖 `/menus/permissions` 返回的权限点集合，集合里没有 biz:category:list
--   ⇒ 「新增根分类 / 新增子分类 / 编辑 / 删除」按钮被隐藏（即用户反馈的
--   「业务分类编辑按钮消失」）。本迁移补上这条授权。
--
-- ## ID 段位（实施前已核实为空闲，绝不与 V1~V139 冲突）
--   sys_role_permission.id = 951012
--   —— 种子授权用小幅 id（95001-95009，见 V123）或 `970000000+…` 公式（V127）；
--      运行时 id 由 `IdGenerator`（≈10^12）生成 ⇒ 951012 既不撞种子也不撞运行时。
--
-- ## 幂等策略（对齐 V123 / V132 的授权范式）
--   固定 id + NOT EXISTS(role_id, perm_type, target_id)（对应 `uk_role_perm` 唯一约束）
--   + 前置 EXISTS（菜单存在且启用 + 角色存在），重复执行天然幂等。
--
-- ⚠️ 只追加；绝不修改 V1~V139（checksum 一旦变更会阻塞整条迁移链）。

INSERT INTO sys_role_permission (id, role_id, perm_type, target_id, created_at)
SELECT 951012, 1, 'menu'::sys_perm_type, 95012, NOW()
WHERE NOT EXISTS (
        SELECT 1 FROM sys_role_permission rp
        WHERE rp.role_id = 1
          AND rp.perm_type = 'menu'::sys_perm_type
          AND rp.target_id = 95012)
  AND EXISTS (SELECT 1 FROM sys_menu m WHERE m.id = 95012 AND m.status = 1)
  AND EXISTS (SELECT 1 FROM sys_role r WHERE r.id = 1);

-- 自检（取消注释手动执行）：
-- SELECT id, role_id, perm_type, target_id FROM sys_role_permission
--   WHERE role_id = 1 AND perm_type = 'menu'::sys_perm_type AND target_id = 95012;  -- 应恰 1 行
