-- V139__biz_category_menu_api.sql
-- 新增「业务分类」菜单 + 端点登记，并休眠旧分类端点 | PostgreSQL 16 | 幂等
--
-- ## 背景（对齐 docs/design/biz-category-unification-design.md §3）
--   「业务分类」是独立管理菜单（不再是流程/表单页内的内嵌面板）。
--   deny-unmapped:true：新端点必须登记 sys_api 且绑定到启用菜单，否则 403（本仓老坑）。
--
-- ## ID 段位（实施前已核验为空闲段，绝不与 V1~V137 冲突）
--   sys_menu       95012（空闲）
--   sys_api        95093-95098（空闲）
--   sys_menu_api   95093-95098（空闲）
--
-- ## 幂等策略（对齐 V128 / V132 / V133）
--   * 菜单 / 端点 / 绑定：固定 id + NOT EXISTS(同 id) + NOT EXISTS(同 code) + NOT EXISTS(同 method+path)
--   * 绑定：外键目标前置 EXISTS（menu 启用 + api 存在）
--   * 休眠：UPDATE ... SET status=0 重复执行天然幂等
--
-- ⚠️ 只追加；绝不修改 V1~V138（checksum 变更会阻塞整条迁移链）。

-- ===========================================================================
-- 1) 菜单：业务分类（挂「系统管理」id=200 下）
--    页面类型 type=2；权限点 biz:category:list；前端路由 /system/biz-category。
-- ===========================================================================
INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
  (95012, 1, 1, 200, 'biz-category', '业务分类', 2, '/system/biz-category', NULL, 'biz:category:list', 'FolderTree', 23, 1, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu WHERE app_id = v.app_id AND code = v.code);

-- ===========================================================================
-- 2) 端点登记 sys_api 95093-95098（module_id=95010 任务流模块；parent_id=95010 catalog 节点）
--    路径为 BFF 对外路径，与 mis-taskflow 内部 /internal/v1/biz-categories/* 一一对应。
-- ===========================================================================
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
  (95093, 95010, 95010, 'biz_category_tree',   'api'::sys_api_node_type, '业务分类树',   'GET',    '/api/v1/biz-categories/tree',         93, 1, NOW(), NOW()),
  (95094, 95010, 95010, 'biz_category_list',   'api'::sys_api_node_type, '业务分类列表', 'GET',    '/api/v1/biz-categories',              94, 1, NOW(), NOW()),
  (95095, 95010, 95010, 'biz_category_create', 'api'::sys_api_node_type, '新增业务分类', 'POST',   '/api/v1/biz-categories',              95, 1, NOW(), NOW()),
  (95096, 95010, 95010, 'biz_category_update', 'api'::sys_api_node_type, '更新业务分类', 'PUT',    '/api/v1/biz-categories/{id:[0-9]+}',  96, 1, NOW(), NOW()),
  (95097, 95010, 95010, 'biz_category_delete', 'api'::sys_api_node_type, '删除业务分类', 'DELETE', '/api/v1/biz-categories/{id:[0-9]+}',  97, 1, NOW(), NOW()),
  (95098, 95010, 95010, 'biz_category_get',    'api'::sys_api_node_type, '业务分类详情', 'GET',    '/api/v1/biz-categories/{id:[0-9]+}',  98, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api a WHERE a.module_id = 95010 AND a.code = v.code)
  AND NOT EXISTS (
    SELECT 1 FROM sys_api a
    WHERE a.type = 'api' AND a.status = 1
      AND a.http_method = v.http_method AND a.path_pattern = v.path_pattern
  );

-- ===========================================================================
-- 3) 业务分类端点 sys_menu_api 绑定（95093-95098 → 95012 业务分类）
-- ===========================================================================
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
  (95093, 95012, 95093, 1, NOW()),
  (95094, 95012, 95094, 2, NOW()),
  (95095, 95012, 95095, 3, NOW()),
  (95096, 95012, 95096, 4, NOW()),
  (95097, 95012, 95097, 5, NOW()),
  (95098, 95012, 95098, 6, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu_api ma WHERE ma.menu_id = v.menu_id AND ma.api_id = v.api_id)
  AND EXISTS (SELECT 1 FROM sys_menu m WHERE m.id = v.menu_id AND m.status = 1)
  AND EXISTS (SELECT 1 FROM sys_api a WHERE a.id = v.api_id);

-- ===========================================================================
-- 4) 休眠旧分类端点（保留行，status=0；对齐 V133 先例）
--    wf_category 95060-95065 / form_category 95066-95071。
-- ===========================================================================
UPDATE sys_api SET status = 0 WHERE id BETWEEN 95060 AND 95071;

-- 自检（取消注释手动执行）：
-- SELECT id, code, name, path, permission FROM sys_menu WHERE id = 95012;
-- SELECT id, code, http_method, path_pattern FROM sys_api WHERE id BETWEEN 95093 AND 95098 ORDER BY id;
-- SELECT id, menu_id, api_id FROM sys_menu_api WHERE api_id BETWEEN 95093 AND 95098 ORDER BY id;
-- SELECT id, status FROM sys_api WHERE id BETWEEN 95060 AND 95071 ORDER BY id;  -- 应全为 0
