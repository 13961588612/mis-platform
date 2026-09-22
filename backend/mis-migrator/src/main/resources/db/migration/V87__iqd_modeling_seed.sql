-- ===========================================================================
-- V87__iqd_modeling_seed.sql —— 可视化建模台（v1.11 / M1 T01）建表 + 权限种子
-- PostgreSQL 16 | 库名: mis_platform
-- 前置：V71（iqd_* 表结构）；V77（问数独立门户 sys_app 93010 + 根目录 93030）；
--       V80（iqd_edit_idempotency / edit_revision）；V81（目录 92500 + code 0096 段）；
--       V83（iqd_connection.mcp_status/mcp_port）；V84（selfheal 端点 + code 00960018-00960020）
--
-- 内容：
--   1. 建表 iqd_model_layout（MR-S4：连接级布局 JSONB，Q6 独立存储，不动 V71 表结构）
--   2. sys_menu 92600：建模台主页（type=1，visible=1，path=/iqd/modeling，icon=Workflow）
--   3. sys_menu 92631-92633：3 个权限码按钮（type=3；iqd:modeling:view/edit/publish）
--   4. sys_api 92601-92612：8 建模台端点 + 4 表发现端点（code 0096 段续 00960021-00960032）
--   5. sys_menu_api 92613-92624：接口 ⇄ 菜单绑定（12 条，全部挂 iqd:modeling:edit）
--   6. sys_role_permission 92625-92627：授权内置租户管理员 role_id=1（3 权限码）
--
-- ⚠️ 段位（已核实 V69/V73/V77/V82/V83-V86 占用情况）：
--   sys_menu    ：92500-92527 已用（V72/V73/V74/V78/V81/V84）→ 本文件取 92600 + 92631-92633
--   sys_api     ：92550-92595 已用（V72/V73/V74/V78/V81/V84）→ 本文件取 92601-92612
--   sys_menu_api：92551-92598 已用 → 本文件取 92613-92624
--   sys_role_permission：无固定段，本文件取 92625-92627
--   sys_api code：module 92020 下 00960001-00960020 已用（V78/V81/V84）→ 续 00960021-00960032
--
-- 硬规则（同 V72-V84）：每个 /api/v1/iqd/** 端点必须**同时**写 sys_api + sys_menu_api
-- （BFF 注册表 = sys_api ⋈ sys_menu_api ⋈ sys_menu INNER JOIN；deny-unmapped=true 时只插一个表
-- → 40300「接口未授权映射」）。`/internal/v1/**` 一律不登记（无 MIS JWT，登记反而 401）。
--
-- 幂等：固定 ID + WHERE NOT EXISTS；建表 CREATE TABLE IF NOT EXISTS；
--       索引用 CREATE INDEX IF NOT EXISTS；append-only，可安全重跑（干净库/存量库均适用）。
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. iqd_model_layout —— 连接级画布布局（MR-S4，Q6 独立 JSONB 存储）
--    layout_json    : {nodes:[{item_key,x,y,width,height,collapsed}], edges:[{id,source,target,source_handle,target_handle}]}
--    viewport_json  : {x,y,zoom}
--    version        : PUT 乐观并发基线（base_version）
--    注意：本表为**视图数据**，不参与 MDL 派生（视图/模型分离，Q1/Q6）。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS iqd_model_layout (
    id                  BIGINT PRIMARY KEY,
    connection_id       BIGINT       NOT NULL,
    layout_json         JSONB        NOT NULL,
    viewport_json       JSONB        NULL,
    auto_layout_version INT          NOT NULL DEFAULT 0,
    updated_by          VARCHAR(64)  NULL,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    version             INT          NOT NULL DEFAULT 0,
    CONSTRAINT uk_iqd_model_layout_conn UNIQUE (connection_id),
    CONSTRAINT fk_iqd_model_layout_conn FOREIGN KEY (connection_id) REFERENCES iqd_connection(id)
);

CREATE INDEX IF NOT EXISTS idx_iqd_ml_conn ON iqd_model_layout (connection_id);

COMMENT ON TABLE  iqd_model_layout IS '问数建模台画布布局（连接级，视图数据；MR-S4）';
COMMENT ON COLUMN iqd_model_layout.layout_json IS '画布节点坐标 + 边锚点 JSONB（{nodes,edges}）';
COMMENT ON COLUMN iqd_model_layout.viewport_json IS '画布视口 JSONB（{x,y,zoom}）';
COMMENT ON COLUMN iqd_model_layout.auto_layout_version IS '最近一次自动布局覆盖版本（0=未自动布局过）';
COMMENT ON COLUMN iqd_model_layout.version IS 'PUT 乐观并发基线（body.base_version 不符 → 40900）';

-- ---------------------------------------------------------------------------
-- 2. sys_menu —— 建模台主页（type=1，visible=1，挂问数根目录 93030）
--    与 lib/nav/iqd-nav.ts 的 leaf /iqd/modeling（icon Workflow）严格一一对应。
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (92600, 1, 93010, 93030, 'iqd-modeling-page', '可视化建模台', 1, '/iqd/modeling', 'agent/iqd/iqd-modeling-page', NULL, 'Workflow', 2, 1, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu m WHERE m.app_id = 93010 AND m.path = v.path)
  AND EXISTS (SELECT 1 FROM sys_app  WHERE id = 93010)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = 93030);

-- ---------------------------------------------------------------------------
-- 3. sys_menu —— 3 个权限码按钮（type=3；不进侧栏，只承载 permission）
--    MR-S3：iqd:modeling:view / :edit / :publish，一次落库，T02~T04 仅消费。
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (92631, 1, 93010, 92600, 'iqd-modeling-view',    '建模台查看', 3, NULL, NULL, 'iqd:modeling:view',    NULL, 31, 1, 1, NOW(), NOW()),
    (92632, 1, 93010, 92600, 'iqd-modeling-edit',    '建模台编辑', 3, NULL, NULL, 'iqd:modeling:edit',    NULL, 32, 1, 1, NOW(), NOW()),
    (92633, 1, 93010, 92600, 'iqd-modeling-publish', '建模台发布', 3, NULL, NULL, 'iqd:modeling:publish', NULL, 33, 1, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu m WHERE m.app_id = 93010 AND m.permission = v.permission)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = 92600);

-- ---------------------------------------------------------------------------
-- 4. sys_api —— 12 个端点（module 92020；code 0096 段续 00960021-00960032）
--    前 8 条 = 建模台端点（BFF → mis-iqd）；后 4 条 = 表发现端点（BFF → ai-platform Worker）。
--    全部为前端可达的 /api/v1/iqd/** 路径（sys_api 只管 BFF 注册表，与下游落点无关）。
-- ---------------------------------------------------------------------------
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    -- 8 建模台端点
    (92601, 92020, 92550, '00960021', 'api'::sys_api_node_type, '建模台-新建连接',         'POST', '/api/v1/iqd/connections',                        21, 1, NOW(), NOW()),
    (92602, 92020, 92550, '00960022', 'api'::sys_api_node_type, '建模台-连接连通自检',     'POST', '/api/v1/iqd/connections/{id}/test',           22, 1, NOW(), NOW()),
    (92603, 92020, 92550, '00960023', 'api'::sys_api_node_type, '建模台-空白模型创建',     'POST', '/api/v1/iqd/catalog/model',                     23, 1, NOW(), NOW()),
    (92604, 92020, 92550, '00960024', 'api'::sys_api_node_type, '建模台-由表生成模型',     'POST', '/api/v1/iqd/catalog/model/from-table',          24, 1, NOW(), NOW()),
    (92605, 92020, 92550, '00960025', 'api'::sys_api_node_type, '建模台-新建关系',         'POST', '/api/v1/iqd/catalog/relationship',              25, 1, NOW(), NOW()),
    (92606, 92020, 92550, '00960026', 'api'::sys_api_node_type, '建模台-新建 Cube',        'POST', '/api/v1/iqd/catalog/cube',                      26, 1, NOW(), NOW()),
    (92607, 92020, 92550, '00960027', 'api'::sys_api_node_type, '建模台-新建计算列',       'POST', '/api/v1/iqd/catalog/calculated-column',         27, 1, NOW(), NOW()),
    (92608, 92020, 92550, '00960028', 'api'::sys_api_node_type, '建模台-表达式静态校验',   'GET',  '/api/v1/iqd/catalog/validate-expression',       28, 1, NOW(), NOW()),
    -- 4 表发现端点（a 点；BFF → ai-platform Worker /internal/v1/iqd/discovery/**）
    (92609, 92020, 92550, '00960029', 'api'::sys_api_node_type, '建模台-表发现 schema 列表', 'GET',  '/api/v1/iqd/discovery/schemas',                  29, 1, NOW(), NOW()),
    (92610, 92020, 92550, '00960030', 'api'::sys_api_node_type, '建模台-表发现 表清单',      'GET',  '/api/v1/iqd/discovery/tables',                   30, 1, NOW(), NOW()),
    (92611, 92020, 92550, '00960031', 'api'::sys_api_node_type, '建模台-表发现 列清单',      'GET',  '/api/v1/iqd/discovery/columns',                  31, 1, NOW(), NOW()),
    (92612, 92020, 92550, '00960032', 'api'::sys_api_node_type, '建模台-表发现 批量导入',    'POST', '/api/v1/iqd/discovery/import',                   32, 1, NOW(), NOW())
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
-- 5. sys_menu_api —— 接口 ⇄ 菜单绑定（12 条；permission 由菜单侧提供）
--    12 个端点的权限码按 system-design §3.3 均为 iqd:modeling:edit → 挂菜单 92632。
--    （iqd:modeling:view / :publish 的端点归属：layout GET/PUT 在 T03 追加绑定。）
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (92613, 92632, 92601, 1, NOW()),   -- POST /connections                     → iqd:modeling:edit
    (92614, 92632, 92602, 1, NOW()),   -- POST /connections/{id}/test           → iqd:modeling:edit
    (92615, 92632, 92603, 1, NOW()),   -- POST /catalog/model                   → iqd:modeling:edit
    (92616, 92632, 92604, 1, NOW()),   -- POST /catalog/model/from-table        → iqd:modeling:edit
    (92617, 92632, 92605, 1, NOW()),   -- POST /catalog/relationship            → iqd:modeling:edit
    (92618, 92632, 92606, 1, NOW()),   -- POST /catalog/cube                    → iqd:modeling:edit
    (92619, 92632, 92607, 1, NOW()),   -- POST /catalog/calculated-column       → iqd:modeling:edit
    (92620, 92632, 92608, 1, NOW()),   -- GET  /catalog/validate-expression     → iqd:modeling:edit
    (92621, 92632, 92609, 1, NOW()),   -- GET  /discovery/schemas               → iqd:modeling:edit
    (92622, 92632, 92610, 1, NOW()),   -- GET  /discovery/tables                → iqd:modeling:edit
    (92623, 92632, 92611, 1, NOW()),   -- GET  /discovery/columns               → iqd:modeling:edit
    (92624, 92632, 92612, 1, NOW())    -- POST /discovery/import                → iqd:modeling:edit
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (
    SELECT 1 FROM sys_menu_api ma WHERE ma.menu_id = v.menu_id AND ma.api_id = v.api_id
  )
  AND EXISTS (SELECT 1 FROM sys_menu m WHERE m.id = v.menu_id AND m.status = 1)
  AND EXISTS (SELECT 1 FROM sys_api  a WHERE a.id = v.api_id);

-- ---------------------------------------------------------------------------
-- 6. sys_role_permission —— 授权内置租户管理员（role_id=1）：3 个建模台权限码
--    固定 id 92625-92627；target_id 指向对应权限码菜单（92631/92632/92633）。
-- ---------------------------------------------------------------------------
INSERT INTO sys_role_permission (id, role_id, perm_type, target_id, created_at)
SELECT v.id, 1, 'menu'::sys_perm_type, v.target_id, NOW()
FROM (VALUES
    (92625, 92631),   -- iqd:modeling:view
    (92626, 92632),   -- iqd:modeling:edit
    (92627, 92633)    -- iqd:modeling:publish
) AS v(id, target_id)
WHERE EXISTS (
    SELECT 1 FROM sys_menu m
    WHERE m.id = v.target_id AND m.app_id = 93010 AND m.status = 1
  )
  AND NOT EXISTS (
    SELECT 1 FROM sys_role_permission rp
    WHERE rp.role_id = 1 AND rp.perm_type = 'menu' AND rp.target_id = v.target_id
  )
  AND NOT EXISTS (SELECT 1 FROM sys_role_permission rp2 WHERE rp2.id = v.id)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 迁移后自检（取消注释执行；不在迁移中运行）
--
--   -- 1) 建表
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns WHERE table_name = 'iqd_model_layout' ORDER BY ordinal_position;
--
--   -- 2) 菜单（期望：92600 主页 + 92631-92633 三权限码按钮）
--   SELECT id, code, name, type, path, permission, icon, visible FROM sys_menu
--   WHERE id IN (92600, 92631, 92632, 92633) ORDER BY id;
--
--   -- 3) 端点 + 绑定（期望 12 行，permission 全为 iqd:modeling:edit）
--   SELECT a.id, a.http_method, a.path_pattern, m.permission
--   FROM sys_api a
--   JOIN sys_menu_api ma ON ma.api_id = a.id
--   JOIN sys_menu m      ON ma.menu_id = m.id
--   WHERE a.id BETWEEN 92601 AND 92612
--   ORDER BY a.sort;
--
--   -- 4) 授权（期望 3 行 role_id=1）
--   SELECT id, role_id, perm_type, target_id FROM sys_role_permission
--   WHERE id BETWEEN 92625 AND 92627 ORDER BY id;
-- ---------------------------------------------------------------------------
