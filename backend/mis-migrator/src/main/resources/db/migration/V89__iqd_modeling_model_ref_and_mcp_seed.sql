-- ===========================================================================
-- V89__iqd_modeling_model_ref_and_mcp_seed.sql —— 建模台收口（v1.11 / T02b-3）
-- PostgreSQL 16 | 库名: mis_platform
-- 前置：V87（建模台主页 92600 / 权限按钮 92631-92633 / 12 条 sys_api 92601-92612）；
--       V88（补登 5 端点 + 5 绑定，id 92640-92649，code 至 00960037）；
--       V81/V84（code 段 00960016 / 00960020 序列）
--
-- 一次补齐 3 个缺口（省一轮发布）：
--   【A】iqd_catalog_item 新增 model_ref 列 —— Cube→Model 的确定性关联
--   【B】6 条 /api/v1/iqd/mcp/** 端点登记（sys_api + sys_menu_api）
--   【C】iqd:mcp:manage 权限码（sys_menu 按钮 + sys_role_permission 授权）
--
-- ⚠️ V87 / V88 **一字不动**。
--
-- ---------------------------------------------------------------------------
-- 【A】为什么补 model_ref 而不复用 expression（T03 裁决采纳的结论）
-- ---------------------------------------------------------------------------
-- 现状：`iqd_catalog_item` 没有 model_ref 列；而唯一在写 cube 的路径（MDL 同步
-- `IqdMdlParser:158`）把 `expression = node.expression ?? node.baseObject` —— 即
-- **对 cube 来说 expression 已是二义列**（真实表达式 / 所属模型名兜底）。
-- 若再把 model_ref 挤进 expression：
--   ① 同一列含义依赖 source/kind，每个消费者都要分支；
--   ② `IqdAdminService.validateCatalogRefs` 用 `expression.contains(item_key)` 做**反向引用**
--      扫描 —— 会出现「表达式里恰好含该子串 → 误判为引用方」，以及 T03 把 expression 改写为
--      真实 SQL 后「引用关系无声消失 → 改名守卫静默失效」两种失效；
--   ③ T03 要做的**正向**校验（§4.3：cube 创建时校验 model_ref 存在）需要确定性关联。
-- 故补列。**可空、无 NOT NULL、无回填**（`baseObject` 是否恰为模型名需 W0 实测，见
-- 待办清单；MDL cube 的归靠继续走 expression 兜底，仅 T03 新写入的 cube 填 model_ref）。
--
-- ---------------------------------------------------------------------------
-- 【B】/【C】权限码核实结论（**先核实再写种子**）
-- ---------------------------------------------------------------------------
-- 这 6 个 MCP 端点**不是** `@PreAuthorize` 注解式校验，而是 `IqdFacadeService` 里
-- **程序化**判定：
--     IqdFacadeService:365  mcpManage(start|stop|restart) → requirePermission(properties.getMcpManagerPermission())
--     IqdFacadeService:381  mcpStatus                       → 同上
--     IqdFacadeService:391  mcpList                         → 同上
--     IqdFacadeService:410  enableProject(/mcp/enable)      → 同上
-- 而 `IqdProperties:70` → `private String mcpManagerPermission = "iqd:mcp:manage";`
-- ⇒ **实际校验码 = `iqd:mcp:manage`**（非 `iqd:modeling:edit`）。
-- 因此本迁移必须：① 把 6 条端点绑定到 `iqd:mcp:manage`；② 把该权限码种进 sys_menu
-- （type=3 按钮，否则 role 无从授权、按钮对所有人灰掉）。
-- 语义上也更贴切：MCP 进程启停影响该连接下**所有用户**的问数服务，比「编辑一个模型」重。
--
-- 段位（已 grep 全仓核实空闲）：
--   sys_api      ：…至 92644（V88）→ 本文件取 92650-92655
--   sys_menu     ：…92600/92631-92633（V87）→ 本文件取 92656
--   sys_menu_api ：…至 92649（V88）→ 本文件取 92657-92662
--   sys_role_permission：…至 92627（V87）→ 本文件取 92663
--   sys_api code ：module 92020 下至 00960037（V88）→ 续 00960038-00960043
--
-- 硬规则（同 V72-V88）：每个 /api/v1/iqd/** 端点必须**同时**写 sys_api + sys_menu_api
-- （BFF 注册表 = sys_api ⋈ sys_menu_api ⋈ sys_menu INNER JOIN）。/internal/v1/** 不登记。
--
-- 幂等：固定 ID + WHERE NOT EXISTS + (method,path) / (menu,api) 去重；append-only，可安全重跑。
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 【A】model_ref 列（Cube → Model 确定性关联；可空、无回填）
-- ---------------------------------------------------------------------------
ALTER TABLE iqd_catalog_item ADD COLUMN IF NOT EXISTS model_ref VARCHAR(255);

COMMENT ON COLUMN iqd_catalog_item.model_ref IS
    'Cube 所属模型 item_key（如 mdl:model:orders）；仅 kind=cube 使用。NULL=未记录（含 MDL 同步来源，其归属暂由 expression/baseObject 兜底）。V89 新增。';

-- ---------------------------------------------------------------------------
-- 【C】iqd:mcp:manage 权限按钮（type=3，挂在建模台主页 92600 下）
--      —— 必须先于 sys_menu_api（绑定需引用该 menu）
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (92656, 1, 93010, 92600, 'iqd-modeling-mcp-manage', 'MCP 进程管理', 3, NULL, NULL, 'iqd:mcp:manage', NULL, 34, 1, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu m WHERE m.app_id = v.app_id AND m.code = v.code)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = 92600);

-- ---------------------------------------------------------------------------
-- 【B-1】sys_api —— 6 条 MCP 端点（module 92020；code 00960038-00960043）
-- ---------------------------------------------------------------------------
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (92650, 92020, 92550, '00960038', 'api'::sys_api_node_type, 'MCP-启动进程',     'POST', '/api/v1/iqd/mcp/start',   38, 1, NOW(), NOW()),
    (92651, 92020, 92550, '00960039', 'api'::sys_api_node_type, 'MCP-停止进程',     'POST', '/api/v1/iqd/mcp/stop',    39, 1, NOW(), NOW()),
    (92652, 92020, 92550, '00960040', 'api'::sys_api_node_type, 'MCP-重启进程',     'POST', '/api/v1/iqd/mcp/restart', 40, 1, NOW(), NOW()),
    (92653, 92020, 92550, '00960041', 'api'::sys_api_node_type, 'MCP-启用连接项目', 'POST', '/api/v1/iqd/mcp/enable',  41, 1, NOW(), NOW()),
    (92654, 92020, 92550, '00960042', 'api'::sys_api_node_type, 'MCP-单连接状态',   'GET',  '/api/v1/iqd/mcp/status',  42, 1, NOW(), NOW()),
    (92655, 92020, 92550, '00960043', 'api'::sys_api_node_type, 'MCP-端点清单',     'GET',  '/api/v1/iqd/mcp/list',    43, 1, NOW(), NOW())
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
-- 【B-2】sys_menu_api —— 6 条绑定（全部指向 92656 = iqd:mcp:manage，与代码校验一致）
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (92657, 92656, 92650, 1, NOW()),   -- POST /mcp/start   → iqd:mcp:manage
    (92658, 92656, 92651, 2, NOW()),   -- POST /mcp/stop    → iqd:mcp:manage
    (92659, 92656, 92652, 3, NOW()),   -- POST /mcp/restart → iqd:mcp:manage
    (92660, 92656, 92653, 4, NOW()),   -- POST /mcp/enable  → iqd:mcp:manage
    (92661, 92656, 92654, 5, NOW()),   -- GET  /mcp/status  → iqd:mcp:manage
    (92662, 92656, 92655, 6, NOW())    -- GET  /mcp/list    → iqd:mcp:manage
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (
    SELECT 1 FROM sys_menu_api ma WHERE ma.menu_id = v.menu_id AND ma.api_id = v.api_id
  )
  AND EXISTS (SELECT 1 FROM sys_menu m WHERE m.id = v.menu_id AND m.status = 1)
  AND EXISTS (SELECT 1 FROM sys_api  a WHERE a.id = v.api_id);

-- ---------------------------------------------------------------------------
-- 【C-2】sys_role_permission —— 角色 1 授予 iqd:mcp:manage（key 与建模台同角色）
-- ---------------------------------------------------------------------------
INSERT INTO sys_role_permission (id, role_id, perm_type, target_id, created_at)
SELECT v.id, 1, 'menu'::sys_perm_type, v.target_id, NOW()
FROM (VALUES (92663, 92656)) AS v(id, target_id)
WHERE EXISTS (SELECT 1 FROM sys_menu m WHERE m.id = v.target_id AND m.status = 1)
  AND NOT EXISTS (
    SELECT 1 FROM sys_role_permission rp
    WHERE rp.role_id = 1 AND rp.perm_type = 'menu' AND rp.target_id = v.target_id
  )
  AND NOT EXISTS (SELECT 1 FROM sys_role_permission rp2 WHERE rp2.id = v.id)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 迁移后自检（取消注释执行；不在迁移中运行）
--
--   -- 1) model_ref 列已加（期望 1 行，is_nullable=YES，无默认）
--   SELECT column_name, data_type, character_maximum_length, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_name = 'iqd_catalog_item' AND column_name = 'model_ref';
--
--   -- 2) MCP 端点 + 绑定 + 权限码（期望 6 行，permission 全为 iqd:mcp:manage）
--   SELECT a.id, a.http_method, a.path_pattern, m.permission
--   FROM sys_api a
--   JOIN sys_menu_api ma ON ma.api_id = a.id
--   JOIN sys_menu m      ON ma.menu_id = m.id
--   WHERE a.id BETWEEN 92650 AND 92655
--   ORDER BY a.sort;
--
--   -- 3) 权限按钮 + 授权（期望各 1 行）
--   SELECT id, code, name, permission, type, status FROM sys_menu WHERE id = 92656;
--   SELECT id, role_id, perm_type, target_id FROM sys_role_permission WHERE id = 92663;
--
--   -- 4) 前序迁移未受影响（期望 12 / 5）
--   SELECT COUNT(*) AS v87_apis FROM sys_api WHERE id BETWEEN 92601 AND 92612;
--   SELECT COUNT(*) AS v88_apis FROM sys_api WHERE id BETWEEN 92640 AND 92644;
-- ---------------------------------------------------------------------------
