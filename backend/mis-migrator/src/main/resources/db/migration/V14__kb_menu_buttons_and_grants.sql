-- MIS Platform — 知识库（mis-kb）按钮权限补全 + 内置角色授权
-- PostgreSQL 16 | 库名: mis_platform
--
-- 根因：
--   V13__kb_seed.sql 仅写入 KB 的目录 + 8 个页面菜单（type=1/2），既没有写操作的按钮节点
--   （type=3），也没有向 sys_role_permission 授权。结果是：
--     1) 租户管理员登录后 /menus/router 返回不到 KB 菜单 → 侧栏与九宫格入口缺失；
--     2) 前端 PermissionGate 找不到 kb:*:add/edit/delete → 新增/编辑/删除按钮全部隐藏。
--   与 V10 修复「模块管理没有编辑功能」的根因完全同型。
--
-- 处理：
--   A. 为 KB 页面补齐按钮节点（type=3），permission 与前端 PermissionGate 使用的编码一一对应；
--   B. 将 KB 全部菜单（目录/页面/按钮）授权给内置租户管理员 role_id=1。
--   幂等：固定 ID 段（9104x/9105x）+ WHERE NOT EXISTS + ON CONFLICT DO NOTHING，可重复执行。

-- ---------------------------------------------------------------------------
-- A. 按钮节点（type=3），挂在各自页面菜单下
--    父页面 ID 取自 V13：91032 分类 / 91033 知识库 / 91034 文档 / 91035 权限 / 91036 问答
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    -- 分类管理
    (91040, 1, 91010, 91032, 'kb_category_add',    '新增分类',   3, NULL, NULL, 'kb:category:add',    NULL, 1, 1, 1, NOW(), NOW()),
    (91041, 1, 91010, 91032, 'kb_category_edit',   '编辑分类',   3, NULL, NULL, 'kb:category:edit',   NULL, 2, 1, 1, NOW(), NOW()),
    (91042, 1, 91010, 91032, 'kb_category_delete', '删除分类',   3, NULL, NULL, 'kb:category:delete', NULL, 3, 1, 1, NOW(), NOW()),
    -- 知识库管理
    (91043, 1, 91010, 91033, 'kb_library_add',     '新增知识库', 3, NULL, NULL, 'kb:library:add',     NULL, 1, 1, 1, NOW(), NOW()),
    (91044, 1, 91010, 91033, 'kb_library_edit',    '编辑知识库', 3, NULL, NULL, 'kb:library:edit',    NULL, 2, 1, 1, NOW(), NOW()),
    (91045, 1, 91010, 91033, 'kb_library_delete',  '删除知识库', 3, NULL, NULL, 'kb:library:delete',  NULL, 3, 1, 1, NOW(), NOW()),
    -- 文档管理（add=上传，edit=启停/重解析）
    (91046, 1, 91010, 91034, 'kb_document_add',    '上传文档',   3, NULL, NULL, 'kb:document:add',    NULL, 1, 1, 1, NOW(), NOW()),
    (91047, 1, 91010, 91034, 'kb_document_edit',   '维护文档',   3, NULL, NULL, 'kb:document:edit',   NULL, 2, 1, 1, NOW(), NOW()),
    (91048, 1, 91010, 91034, 'kb_document_delete', '删除文档',   3, NULL, NULL, 'kb:document:delete', NULL, 3, 1, 1, NOW(), NOW()),
    -- 权限（ACL）
    (91049, 1, 91010, 91035, 'kb_acl_grant',       '新增授权',   3, NULL, NULL, 'kb:acl:grant',       NULL, 1, 1, 1, NOW(), NOW()),
    (91050, 1, 91010, 91035, 'kb_acl_revoke',      '撤销授权',   3, NULL, NULL, 'kb:acl:revoke',      NULL, 2, 1, 1, NOW(), NOW()),
    -- 问答反馈
    (91051, 1, 91010, 91036, 'kb_qa_feedback',     '提交反馈',   3, NULL, NULL, 'kb:qa:feedback',     NULL, 1, 1, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = v.id);

-- ---------------------------------------------------------------------------
-- B. 授权给内置租户管理员 role_id=1（目录 + 页面 + 按钮，口径与 V9/V10 一致）
-- ---------------------------------------------------------------------------
INSERT INTO sys_role_permission (id, role_id, perm_type, target_id, created_at)
SELECT m.id, 1, 'menu'::sys_perm_type, m.id, NOW()
FROM sys_menu m
WHERE m.app_id = 91010
  AND m.status = 1
  AND NOT EXISTS (
    SELECT 1 FROM sys_role_permission rp
    WHERE rp.role_id = 1 AND rp.perm_type = 'menu' AND rp.target_id = m.id
  )
ON CONFLICT (id) DO NOTHING;
