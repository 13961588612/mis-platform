-- ===========================================================================
-- V96__iqd_modeling_permission_seed_fix.sql
-- 修复：联调库 V87~V92 历史已记，但建模台菜单/权限/端点种子未落地；
--       且 id=92600 被旧版「iqd:mcp:manage」占用（与现仓库 V87 建模台主页冲突）。
--
-- 本迁移幂等：
--   A. 把 92600 上的 MCP 权限钮迁到规范位 92656，并改绑 menu_api / role_permission
--   B. 将 92600 纠正为建模台主页；补 92631/92632/92633 三权限钮
--   C. 授权 TENANT_ADMIN(role_id=1)；若存在 IT-TESTER 角色一并授权（联调常用账号）
--   D. 补登建模台核心 sys_api + sys_menu_api（用空闲 ID/code，避开库内已占 MCP/datasources）
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A-1. 规范位：iqd:mcp:manage → sys_menu 92656（暂挂 92500；A-3 后再挂到 92600）
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (92656, 1, 93010, 92500, 'iqd-modeling-mcp-manage', 'MCP 进程管理', 3, NULL::VARCHAR, NULL::VARCHAR, 'iqd:mcp:manage', NULL::VARCHAR, 34, 1, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu m WHERE m.app_id = 93010 AND m.permission = 'iqd:mcp:manage')
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = 92500);

-- 若 92600 仍是旧 MCP 钮，而 92656 已存在（或上面刚插入），把绑定切到 92656
UPDATE sys_menu_api ma
SET menu_id = 92656
WHERE ma.menu_id = 92600
  AND EXISTS (SELECT 1 FROM sys_menu m WHERE m.id = 92656 AND m.permission = 'iqd:mcp:manage')
  AND EXISTS (
    SELECT 1 FROM sys_menu cur
    WHERE cur.id = 92600 AND cur.permission = 'iqd:mcp:manage'
  )
  AND NOT EXISTS (
    SELECT 1 FROM sys_menu_api x WHERE x.menu_id = 92656 AND x.api_id = ma.api_id
  );

-- 角色授权：把指向「旧 92600 MCP」的授权改到 92656
UPDATE sys_role_permission rp
SET target_id = 92656
WHERE rp.target_id = 92600
  AND EXISTS (SELECT 1 FROM sys_menu m WHERE m.id = 92656 AND m.permission = 'iqd:mcp:manage')
  AND EXISTS (
    SELECT 1 FROM sys_menu cur
    WHERE cur.id = 92600 AND cur.permission = 'iqd:mcp:manage'
  )
  AND NOT EXISTS (
    SELECT 1 FROM sys_role_permission x
    WHERE x.role_id = rp.role_id AND x.perm_type = rp.perm_type AND x.target_id = 92656
  );

-- 兜底：role_id=1 授予 92656
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
-- A-2 / B-1. 纠正 92600 → 建模台主页；或在无冲突时插入
-- ---------------------------------------------------------------------------
UPDATE sys_menu
SET tenant_id  = 1,
    app_id     = 93010,
    parent_id  = 93030,
    code       = 'iqd-modeling-page',
    name       = '可视化建模台',
    type       = 1,
    path       = '/iqd/modeling',
    component  = 'agent/iqd/iqd-modeling-page',
    permission = NULL,
    icon       = 'Workflow',
    sort       = 2,
    visible    = 1,
    status     = 1,
    updated_at = NOW()
WHERE id = 92600
  AND (
    permission = 'iqd:mcp:manage'
    OR code = 'iqd-mcp-manage'
    OR path IS DISTINCT FROM '/iqd/modeling'
  );

INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (92600, 1, 93010, 93030, 'iqd-modeling-page', '可视化建模台', 1, '/iqd/modeling', 'agent/iqd/iqd-modeling-page', NULL::VARCHAR, 'Workflow', 2, 1, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu m WHERE m.app_id = 93010 AND m.path = '/iqd/modeling')
  AND EXISTS (SELECT 1 FROM sys_app WHERE id = 93010)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = 93030);

-- 把 92656 挂到建模台主页下（规范位）
UPDATE sys_menu
SET parent_id = 92600,
    app_id = 93010,
    updated_at = NOW()
WHERE id = 92656
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = 92600 AND path = '/iqd/modeling');

-- ---------------------------------------------------------------------------
-- B-2. 三权限钮 92631/92632/92633
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (92631, 1, 93010, 92600, 'iqd-modeling-view',    '建模台查看', 3, NULL::VARCHAR, NULL::VARCHAR, 'iqd:modeling:view',    NULL::VARCHAR, 31, 1, 1, NOW(), NOW()),
    (92632, 1, 93010, 92600, 'iqd-modeling-edit',    '建模台编辑', 3, NULL::VARCHAR, NULL::VARCHAR, 'iqd:modeling:edit',    NULL::VARCHAR, 32, 1, 1, NOW(), NOW()),
    (92633, 1, 93010, 92600, 'iqd-modeling-publish', '建模台发布', 3, NULL::VARCHAR, NULL::VARCHAR, 'iqd:modeling:publish', NULL::VARCHAR, 33, 1, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu m WHERE m.app_id = 93010 AND m.permission = v.permission)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = 92600 AND path = '/iqd/modeling');

-- ---------------------------------------------------------------------------
-- C. 授权：TENANT_ADMIN +（若存在）IT-TESTER
-- ---------------------------------------------------------------------------
INSERT INTO sys_role_permission (id, role_id, perm_type, target_id, created_at)
SELECT v.id, 1, 'menu'::sys_perm_type, v.target_id, NOW()
FROM (VALUES
    (92625, 92631),
    (92626, 92632),
    (92627, 92633)
) AS v(id, target_id)
WHERE EXISTS (SELECT 1 FROM sys_menu m WHERE m.id = v.target_id AND m.status = 1)
  AND NOT EXISTS (
    SELECT 1 FROM sys_role_permission rp
    WHERE rp.role_id = 1 AND rp.perm_type = 'menu' AND rp.target_id = v.target_id
  )
  AND NOT EXISTS (SELECT 1 FROM sys_role_permission rp2 WHERE rp2.id = v.id)
ON CONFLICT (id) DO NOTHING;

-- IT-TESTER（联调账号 it-tester-001 / IT-TESTER-002）；角色不存在则整段跳过
INSERT INTO sys_role_permission (id, role_id, perm_type, target_id, created_at)
SELECT v.id, r.id, 'menu'::sys_perm_type, v.target_id, NOW()
FROM (VALUES
    (92810, 92631),
    (92811, 92632),
    (92812, 92633),
    (92813, 92656)
) AS v(id, target_id)
JOIN sys_role r ON r.code = 'IT-TESTER'
WHERE EXISTS (SELECT 1 FROM sys_menu m WHERE m.id = v.target_id AND m.status = 1)
  AND NOT EXISTS (
    SELECT 1 FROM sys_role_permission rp
    WHERE rp.role_id = r.id AND rp.perm_type = 'menu' AND rp.target_id = v.target_id
  )
  AND NOT EXISTS (SELECT 1 FROM sys_role_permission rp2 WHERE rp2.id = v.id)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- D. 建模台核心 API（空闲 id 92820+ / code 00960050+；路径去重）
--    绑定到 92631(view) / 92632(edit)
-- ---------------------------------------------------------------------------
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    -- view
    (92820, 92020, 92550, '00960050', 'api'::sys_api_node_type, '建模台-连接清单',        'GET',  '/api/v1/iqd/connections',                            50, 1, NOW(), NOW()),
    (92821, 92020, 92550, '00960051', 'api'::sys_api_node_type, '建模台-取布局',          'GET',  '/api/v1/iqd/modeling/layout/{connId}',            51, 1, NOW(), NOW()),
    (92822, 92020, 92550, '00960052', 'api'::sys_api_node_type, '建模台-依赖方清单',      'GET',  '/api/v1/iqd/dependencies',                        52, 1, NOW(), NOW()),
    -- edit
    (92823, 92020, 92550, '00960053', 'api'::sys_api_node_type, '建模台-新建连接',         'POST', '/api/v1/iqd/connections',                        53, 1, NOW(), NOW()),
    (92824, 92020, 92550, '00960054', 'api'::sys_api_node_type, '建模台-更新连接',         'PUT',  '/api/v1/iqd/connections/{id}',                   54, 1, NOW(), NOW()),
    (92825, 92020, 92550, '00960055', 'api'::sys_api_node_type, '建模台-连接连通自检',     'POST', '/api/v1/iqd/connections/{id}/test',              55, 1, NOW(), NOW()),
    (92826, 92020, 92550, '00960056', 'api'::sys_api_node_type, '建模台-保存布局',        'PUT',  '/api/v1/iqd/modeling/layout/{connId}',            56, 1, NOW(), NOW()),
    (92827, 92020, 92550, '00960057', 'api'::sys_api_node_type, '建模台-一键自动布局',    'POST', '/api/v1/iqd/modeling/layout/{connId}/auto-layout', 57, 1, NOW(), NOW()),
    (92828, 92020, 92550, '00960058', 'api'::sys_api_node_type, '建模台-空白模型创建',     'POST', '/api/v1/iqd/catalog/model',                     58, 1, NOW(), NOW()),
    (92829, 92020, 92550, '00960059', 'api'::sys_api_node_type, '建模台-由表生成模型',     'POST', '/api/v1/iqd/catalog/model/from-table',          59, 1, NOW(), NOW()),
    (92830, 92020, 92550, '00960060', 'api'::sys_api_node_type, '建模台-新建关系',         'POST', '/api/v1/iqd/catalog/relationship',              60, 1, NOW(), NOW()),
    (92831, 92020, 92550, '00960061', 'api'::sys_api_node_type, '建模台-新建 Cube',        'POST', '/api/v1/iqd/catalog/cube',                      61, 1, NOW(), NOW()),
    (92832, 92020, 92550, '00960062', 'api'::sys_api_node_type, '建模台-更新 Cube',        'PUT',  '/api/v1/iqd/catalog/cube',                      62, 1, NOW(), NOW()),
    (92833, 92020, 92550, '00960063', 'api'::sys_api_node_type, '建模台-新建计算列',       'POST', '/api/v1/iqd/catalog/calculated-column',         63, 1, NOW(), NOW()),
    (92834, 92020, 92550, '00960064', 'api'::sys_api_node_type, '建模台-表达式静态校验',   'GET',  '/api/v1/iqd/catalog/validate-expression',       64, 1, NOW(), NOW()),
    (92835, 92020, 92550, '00960065', 'api'::sys_api_node_type, '建模台-表发现 schemas',   'GET',  '/api/v1/iqd/discovery/schemas',                  65, 1, NOW(), NOW()),
    (92836, 92020, 92550, '00960066', 'api'::sys_api_node_type, '建模台-表发现 tables',    'GET',  '/api/v1/iqd/discovery/tables',                   66, 1, NOW(), NOW()),
    (92837, 92020, 92550, '00960067', 'api'::sys_api_node_type, '建模台-表发现 columns',   'GET',  '/api/v1/iqd/discovery/columns',                  67, 1, NOW(), NOW()),
    (92838, 92020, 92550, '00960068', 'api'::sys_api_node_type, '建模台-表发现 import',    'POST', '/api/v1/iqd/discovery/import',                   68, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api a WHERE a.module_id = v.module_id AND a.code = v.code)
  AND NOT EXISTS (
    SELECT 1 FROM sys_api a
    WHERE a.type = 'api' AND a.status = 1
      AND a.http_method = v.http_method
      AND a.path_pattern = v.path_pattern
  )
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 92550);

INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (92840, 92631, 92820, 1, NOW()),
    (92841, 92631, 92821, 1, NOW()),
    (92842, 92631, 92822, 1, NOW()),
    (92843, 92632, 92823, 1, NOW()),
    (92844, 92632, 92824, 1, NOW()),
    (92845, 92632, 92825, 1, NOW()),
    (92846, 92632, 92826, 1, NOW()),
    (92847, 92632, 92827, 1, NOW()),
    (92848, 92632, 92828, 1, NOW()),
    (92849, 92632, 92829, 1, NOW()),
    (92850, 92632, 92830, 1, NOW()),
    (92851, 92632, 92831, 1, NOW()),
    (92852, 92632, 92832, 1, NOW()),
    (92853, 92632, 92833, 1, NOW()),
    (92854, 92632, 92834, 1, NOW()),
    (92855, 92632, 92835, 1, NOW()),
    (92856, 92632, 92836, 1, NOW()),
    (92857, 92632, 92837, 1, NOW()),
    (92858, 92632, 92838, 1, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (
    SELECT 1 FROM sys_menu_api ma WHERE ma.menu_id = v.menu_id AND ma.api_id = v.api_id
  )
  AND EXISTS (SELECT 1 FROM sys_menu m WHERE m.id = v.menu_id AND m.status = 1)
  AND EXISTS (SELECT 1 FROM sys_api  a WHERE a.id = v.api_id);
