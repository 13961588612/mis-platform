-- V77__iqd_standalone_app.sql
-- 问数升级为门户独立 sys_app（仿 91010 / 知识库范式）。前置：V19 / V72 / V73 / V74
-- 边界：925xx id 全保留；仅改 app_id / parent_id / path；后端 API 路径 /api/v1/iqd/**
--       与 sys_menu_api 绑定不变；A2UI 通道（Gateway WS/SSE）不碰（D7）。
--
-- 本迁移**省略**原草案的「步骤2（sys_module 93020 插入）」与「步骤6（sys_api module 更新）」，
-- 原因：/api/v1/iqd/** 的真实后端服务名待确认（D6 可降级项）。跳过不影响菜单独立性，
--       仅意味着 92550~92585 的 module_id 仍保持 92020。
--
-- 幂等约束：固定 ID + WHERE NOT EXISTS / UPDATE 带 guard；append-only，可安全重跑。

-- ① sys_app 93010（code='iqd'，portal_group='ai'，复用「AI助手」分组，前端零改）
INSERT INTO sys_app (id, tenant_id, code, name, icon, base_path, mfe_remote, sort, status,
                     kind, runtime, description, portal_group, created_at, updated_at)
SELECT v.* FROM (VALUES
  (93010, 1, 'iqd', '问数', 'Database', '/iqd', NULL::VARCHAR, 12, 1,
   'subsystem', 'host', '企业问数：自然语言查数、配置与审计', 'ai', NOW(), NOW())
) AS v(id, tenant_id, code, name, icon, base_path, mfe_remote, sort, status,
       kind, runtime, description, portal_group, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_app WHERE id = 93010)
  AND NOT EXISTS (SELECT 1 FROM sys_app WHERE tenant_id = 1 AND code = 'iqd');

-- ③ 根目录 93030（visible=1，path=/iqd，仿 91030；作为 925xx 与旗舰页 93040 的 parent）
INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
  (93030, 1, 93010, 0, 'iqd', '问数', 1, '/iqd', NULL, NULL, 'Database', 1, 1, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = 93030);

-- ④ 旗舰页 93040（原 /ai/data-query，此前无 sys_menu 行；迁至 /iqd/data-query 后补建）
--    permission 复用 'ai:chat:use'（已授权，uk 在 93010 内唯一已验证，见设计 D4）。
INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
  (93040, 1, 93010, 93030, 'iqd-data-query', '问数', 2, '/iqd/data-query', 'agent/ai/data-query-page', 'ai:chat:use', 'Database', 1, 1, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = 93040)
  AND NOT EXISTS (SELECT 1 FROM sys_menu WHERE app_id = 93010 AND path = '/iqd/data-query')
  AND NOT EXISTS (SELECT 1 FROM sys_menu WHERE app_id = 93010 AND permission = 'ai:chat:use');

-- ⑤ 925xx 归位：app_id 92010 -> 93010（id / permission 码 / sys_menu_api 绑定全不动）
UPDATE sys_menu SET app_id = 93010, updated_at = NOW()
WHERE id BETWEEN 92500 AND 92524 AND app_id = 92010;

-- ⑤.1 目录与可见页挂到根目录 93030（脱离 agent 目录 92030）
UPDATE sys_menu SET parent_id = 93030, updated_at = NOW()
WHERE id IN (92500, 92505, 92506, 92507, 92508, 92509, 92520) AND app_id = 93010;

-- ⑤.2 path 改写 /ai/iqd/* -> /iqd/*（仅可见页有 path；按钮 path=NULL 不受影响）
UPDATE sys_menu SET path = '/iqd' || substring(path FROM length('/ai/iqd') + 1), updated_at = NOW()
WHERE app_id = 93010 AND path LIKE '/ai/iqd/%';

-- ⑦ 授权：仅补 93040 对 role_id=1（925xx 的 target_id 不变，其授权由前序迁移已建立）
INSERT INTO sys_role_permission (id, role_id, perm_type, target_id, created_at)
SELECT 93040, 1, 'menu'::sys_perm_type, 93040, NOW()
WHERE NOT EXISTS (SELECT 1 FROM sys_role_permission WHERE role_id = 1 AND perm_type = 'menu' AND target_id = 93040)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 迁移后自检 SQL（取消注释执行；不在迁移中运行）
-- ---------------------------------------------------------------------------
-- SELECT id, app_id, parent_id, code, name, type, path, permission, visible, sort
--   FROM sys_menu WHERE app_id = 93010 ORDER BY parent_id, sort;
-- -- 期望：93030(根,visible=1) + 92500(隐藏目录) + 92505~92509,92520(可见页,path=/iqd/*)
-- --       + 93040(/iqd/data-query,perm=ai:chat:use) + 按钮(92501~92504,92510~92519,92521~92524)
--
-- SELECT id, code, name, runtime, status, portal_group FROM sys_app WHERE code = 'iqd';
-- -- 期望：93010 | iqd | 问数 | host | 1 | ai
--
-- SELECT rp.role_id, rp.target_id FROM sys_role_permission rp
--   WHERE rp.perm_type = 'menu'
--     AND rp.target_id IN (93030, 93040, 92500, 92505, 92506, 92507, 92508, 92509, 92520)
--   ORDER BY rp.target_id;
-- -- 期望：role_id=1 对上述菜单均有记录（925xx 由前序迁移授权，93040 由本迁移补授）
