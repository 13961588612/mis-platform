-- ===========================================================================
-- V72__iqd_menu_api_seed.sql —— 问数（mis-iqd）管理面/Ask 端点 sys_api + 菜单绑定
-- PostgreSQL 16 | 库名: mis_platform
-- 前置：V71（iqd_* 表结构）；V19（agent App 92010 / module 92020 / 目录 92030）
--       V6（ai:chat:use 菜单 613）；V68（A2UI 92400 段）
--
-- 内容（B2 = T-W1-02 打通）：
--   1. sys_menu 92500-92504：IQD 权限码按钮（iqd:config:view/save/test + iqd:trace:view）
--   2. sys_api 92550-92555：5 个 /api/v1/iqd/** 端点（含 ask / ask-stream）
--   3. sys_menu_api 92551-92555：接口 ⇄ 菜单绑定
--      - config 三个端点 → iqd:config:* 新码
--      - ask / ask-stream → 复用既有 ai:chat:use（菜单 613）
--   4. sys_role_permission：授权内置租户管理员（role_id=1）
--
-- ⚠️ 段位说明（已 grep 全仓 V1-V71 核实）：
--   sys_menu 92200-92299 被 V21（ai:skill:*）占用、92300-92399 被 V22（ai:mcp:*）占用、
--   92400-92403 被 V68（A2UI）占用 → 本文件取 **92500-92504**（空闲）。
--   sys_api code 0094 段（module 92020 下 0092=V20/0093=V68，0094 空闲）。
--   sys_api/sys_menu_api id 92550-92555（925xx 全仓无占用）。
--
-- 硬规则：每个 /api/v1/iqd/** 端点必须**同时**写 sys_api + sys_menu_api
-- （BFF 注册表 = sys_api ⋈ sys_menu_api ⋈ sys_menu INNER JOIN；deny-unmapped=true
-- 时只插一个表 → 40300「接口未授权映射」，V61 教训）。
-- 幂等：固定 ID + WHERE NOT EXISTS + (method,path) 去重；append-only。
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. sys_menu —— IQD 权限码按钮节点（type=3；不进侧栏，只承载 permission）
--    父节点：92500（隐藏目录 visible=0，挂 agent 目录 92030 之下）
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (92500, 1, 92010, 92030, 'iqd-config', '问数配置', 1, NULL, NULL, NULL, 'Database', 15, 0, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = v.id)
  AND EXISTS (SELECT 1 FROM sys_app WHERE id = 92010)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = 92030);

INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (92501, 1, 92010, 92500, 'iqd-config-view',  '问数连接配置查看',   3, NULL, NULL, 'iqd:config:view', NULL, 1, 1, 1, NOW(), NOW()),
    (92502, 1, 92010, 92500, 'iqd-config-save',  '问数连接配置保存',   3, NULL, NULL, 'iqd:config:save', NULL, 2, 1, 1, NOW(), NOW()),
    (92503, 1, 92010, 92500, 'iqd-config-test',  '问数连接连通自检',   3, NULL, NULL, 'iqd:config:test', NULL, 3, 1, 1, NOW(), NOW()),
    (92504, 1, 92010, 92500, 'iqd-trace-view',   '问数执行轨迹查看',   3, NULL, NULL, 'iqd:trace:view',  NULL, 4, 1, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu m WHERE m.app_id = 92010 AND m.permission = v.permission)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = 92500);

-- ---------------------------------------------------------------------------
-- 2. sys_api —— IQD 端点注册（module 92020；code 0094 段）
--    ⚠️ /internal/v1/iqd/** 不在此登记：Worker 内网直调，无 MIS JWT（同 V68 exchange
--    豁免口径），登记反而会在拦截器处因缺 LoginUser 直接 401。
-- ---------------------------------------------------------------------------

-- 2.1 catalog 根节点（type='catalog'，不参与判权，仅树形父节点）
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (92550, 92020, 0, '0094', 'catalog'::sys_api_node_type, '问数 API', NULL::VARCHAR, NULL::VARCHAR, 94, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api WHERE module_id = 92020 AND code = v.code)
  AND EXISTS (SELECT 1 FROM sys_module WHERE id = 92020);

-- 2.2 接口行（type='api'）
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (92551, 92020, 92550, '00940001', 'api'::sys_api_node_type, '问数连接配置查看', 'GET',  '/api/v1/iqd/config',       1, 1, NOW(), NOW()),
    (92552, 92020, 92550, '00940002', 'api'::sys_api_node_type, '问数连接配置保存', 'PUT',  '/api/v1/iqd/config',       2, 1, NOW(), NOW()),
    (92553, 92020, 92550, '00940003', 'api'::sys_api_node_type, '问数连接连通自检', 'POST', '/api/v1/iqd/config/test',  3, 1, NOW(), NOW()),
    (92554, 92020, 92550, '00940004', 'api'::sys_api_node_type, '问数（非流式）',   'POST', '/api/v1/iqd/ask',           4, 1, NOW(), NOW()),
    (92555, 92020, 92550, '00940005', 'api'::sys_api_node_type, '问数（SSE 流式）', 'POST', '/api/v1/iqd/ask-stream',    5, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api a WHERE a.module_id = 92020 AND a.code = v.code)
  AND NOT EXISTS (
    SELECT 1 FROM sys_api a
    WHERE a.type = 'api' AND a.status = 1
      AND a.http_method = v.http_method
      AND a.path_pattern = v.path_pattern
  )
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 92550);

-- ---------------------------------------------------------------------------
-- 3. sys_menu_api —— 接口 ⇄ 菜单 关联（permission 由菜单侧提供）
--    92551 → 92501（iqd:config:view）  92552 → 92502（iqd:config:save）
--    92553 → 92503（iqd:config:test）  92554/92555 → 613（ai:chat:use，V6 既有）
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (92551, 92501, 92551, 1, NOW()),
    (92552, 92502, 92552, 1, NOW()),
    (92553, 92503, 92553, 1, NOW()),
    (92554, 613,   92554, 1, NOW()),
    (92555, 613,   92555, 1, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (
    SELECT 1 FROM sys_menu_api ma WHERE ma.menu_id = v.menu_id AND ma.api_id = v.api_id
  )
  AND EXISTS (SELECT 1 FROM sys_menu m WHERE m.id = v.menu_id AND m.status = 1)
  AND EXISTS (SELECT 1 FROM sys_api  a WHERE a.id = v.api_id);

-- ---------------------------------------------------------------------------
-- 4. sys_role_permission —— 授权内置租户管理员（role_id=1，与既有迁移口径一致）
--    ai:chat:use（613）已在 V7 授权；此处只补 iqd 新码。
-- ---------------------------------------------------------------------------
INSERT INTO sys_role_permission (id, role_id, perm_type, target_id, created_at)
SELECT m.id, 1, 'menu'::sys_perm_type, m.id, NOW()
FROM sys_menu m
WHERE m.id IN (92500, 92501, 92502, 92503, 92504)
  AND m.app_id = 92010
  AND m.status = 1
  AND NOT EXISTS (
    SELECT 1 FROM sys_role_permission rp
    WHERE rp.role_id = 1 AND rp.perm_type = 'menu' AND rp.target_id = m.id
  )
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 迁移后自检
--
--   -- 1) sys_menu 权限码登记
--   SELECT id, code, permission FROM sys_menu WHERE id IN (92500, 92501, 92502, 92503, 92504);
--
--   -- 2) sys_api 注册表（5 行，均应带非空 permission）
--   SELECT a.id, a.http_method, a.path_pattern, m.permission
--   FROM sys_api a
--   JOIN sys_menu_api ma ON ma.api_id = a.id
--   JOIN sys_menu m      ON ma.menu_id = m.id
--   WHERE a.module_id = 92020 AND a.type = 'api' AND a.id BETWEEN 92551 AND 92555
--   ORDER BY a.sort;
--   -- 期望：
--   --   92551 GET  /api/v1/iqd/config       iqd:config:view
--   --   92552 PUT  /api/v1/iqd/config       iqd:config:save
--   --   92553 POST /api/v1/iqd/config/test  iqd:config:test
--   --   92554 POST /api/v1/iqd/ask          ai:chat:use
--   --   92555 POST /api/v1/iqd/ask-stream   ai:chat:use
--
--   -- 3) 授权行（5 条：92500-92504）
--   SELECT COUNT(*) FROM sys_role_permission
--   WHERE role_id = 1 AND perm_type = 'menu' AND target_id IN (92500, 92501, 92502, 92503, 92504);
-- ---------------------------------------------------------------------------
