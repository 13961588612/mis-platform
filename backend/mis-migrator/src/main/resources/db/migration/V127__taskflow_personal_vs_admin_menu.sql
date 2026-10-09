-- V127__taskflow_personal_vs_admin_menu.sql
-- 信息架构修正：区分「个人事务」与「管理工作」。
--
-- 背景（实测）：V123 把「工作台」当作 system 子系统的菜单（app_id=1, parent_id=0），
-- 且 4 个子项都设了 permission 且只授予 role_id=1（租户管理员），导致普通员工看不到工作台。
-- 但工作台（我的待办/消息/我发起的/我审批的）本质是每个登录用户的个人事务，
-- 与业务子系统正交，不应挂在「系统管理」下、也不应有功能权限门槛。
--
-- 修正原则：
--   个人事务（/task/*）：permission 置 NULL（登录即可），数据按 assigneeId 隔离。
--   管理工作（流程定义/编排、业务审计、执行监控）：保留 permission 校验。
--
-- 幂等：固定 ID + UPDATE ... WHERE + NOT EXISTS + ON CONFLICT。

-- 1) 个人事务菜单：清除功能权限（登录即可访问自己的数据）
UPDATE sys_menu SET permission = NULL, updated_at = NOW()
WHERE id IN (95001, 95002, 95003, 95004, 95005)
  AND permission IS NOT NULL;

-- 2) 将工作台调整为独立顶级分组（parent_id=0，可见、启用）
UPDATE sys_menu SET parent_id = 0, visible = 1, status = 1, sort = 5, updated_at = NOW()
WHERE id = 95001;

-- 3) 个人事务：对所有启用角色授权（不再只给 role_id=1）。
--    安全 ID：970000000 + (role_id % 100000) * 10 + (menu_id - 95000)，避开 bigint 溢出。
INSERT INTO sys_role_permission (id, role_id, perm_type, target_id, created_at)
SELECT 970000000 + (r.id % 100000) * 10 + (m.id - 95000) AS id,
       r.id, 'menu'::sys_perm_type, m.id, NOW()
FROM sys_role r
CROSS JOIN (VALUES (95001),(95002),(95003),(95004),(95005)) AS m(id)
WHERE r.status = 1
  AND NOT EXISTS (
    SELECT 1 FROM sys_role_permission rp
    WHERE rp.role_id = r.id AND rp.perm_type = 'menu'::sys_perm_type AND rp.target_id = m.id
  )
ON CONFLICT (id) DO NOTHING;

-- 自检（取消注释手动执行）：
-- SELECT id, code, name, parent_id, permission FROM sys_menu WHERE id BETWEEN 95001 AND 95009 ORDER BY id;
-- SELECT r.id, r.code, count(*) FROM sys_role r JOIN sys_role_permission rp ON rp.role_id=r.id
--   WHERE rp.target_id BETWEEN 95001 AND 95005 GROUP BY r.id, r.code;
