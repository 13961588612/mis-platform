-- V86__finance_pos_account_seed.sql
-- 财务辅助 App + 银行账目/POS对账菜单 + BFF 反代 API + legacy-auth/me（authOnly）
-- 设计：docs/adr/ADR-021-finance-pos-account-bff-legacy-token.md
--       docs/integration/smp-auth-service-exchange.md
--       docs/integration/mis-legacy-auth-me.md
--
-- ID 段：94xxx（避开 91 kb / 92 agent / 93 iqd）
-- 幂等：固定 ID + WHERE NOT EXISTS；Flyway 只追加。
--
-- ⚠️ sys_api 无 tenant_id / app_id（V8 已 DROP）；code 为数字串；type 需 ::sys_api_node_type。

-- ---------------------------------------------------------------------------
-- 1. sys_app / sys_module
-- ---------------------------------------------------------------------------
INSERT INTO sys_app (id, tenant_id, code, name, icon, base_path, mfe_remote, sort, status,
                     kind, runtime, description, portal_group, created_at, updated_at)
SELECT v.* FROM (VALUES
  (94010, 1, 'finance', '财务辅助', 'Wallet', '/finance', NULL::VARCHAR, 20, 1,
   'subsystem', 'host', '财务辅助：银行账目与 POS 对账等', 'operations', NOW(), NOW())
) AS v(id, tenant_id, code, name, icon, base_path, mfe_remote, sort, status,
       kind, runtime, description, portal_group, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_app WHERE id = 94010)
  AND NOT EXISTS (SELECT 1 FROM sys_app WHERE tenant_id = 1 AND code = 'finance');

-- service_name 全局唯一（uk_module_service）；V6 已占用 mis-admin-bff，故用逻辑名 mis-finance。
INSERT INTO sys_module (id, code, name, service_name, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
  (94020, 'finance', '财务辅助', 'mis-finance', 20, 1, NOW(), NOW())
) AS v(id, code, name, service_name, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_module WHERE id = 94020)
  AND NOT EXISTS (SELECT 1 FROM sys_module WHERE code = 'finance')
  AND NOT EXISTS (SELECT 1 FROM sys_module WHERE service_name = 'mis-finance');

-- ---------------------------------------------------------------------------
-- 2. 菜单树：财务辅助 → 银行账目 → POS对账 → 四页 + API 按钮
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
  -- 根目录
  (94030, 1, 94010, 0,     'finance',              '财务辅助', 1, '/finance',                              NULL, NULL,                                              'Wallet',  1, 1, 1, NOW(), NOW()),
  -- 银行账目
  (94031, 1, 94010, 94030, 'finance-bank-account',  '银行账目', 1, '/finance/bank-account',                 NULL, NULL,                                              'Landmark', 1, 1, 1, NOW(), NOW()),
  -- POS对账
  (94032, 1, 94010, 94031, 'finance-pos-account',   'POS对账',  1, '/finance/bank-account/pos-account',     NULL, NULL,                                              'Scale',   1, 1, 1, NOW(), NOW()),
  -- 页面（与前端 PAGE_MAP / FINANCE_NAV 一一对应）
  (94033, 1, 94010, 94032, 'finance-pos-terminals', '终端管理', 2, '/finance/bank-account/pos-account/terminals', 'finance/bank-account/pos-account/terminals-page', 'finance:bank-account:pos-account:terminal:list',  'Monitor', 1, 1, 1, NOW(), NOW()),
  (94034, 1, 94010, 94032, 'finance-pos-skt',       '收款台管理', 2, '/finance/bank-account/pos-account/skt',       'finance/bank-account/pos-account/skt-page',       'finance:bank-account:pos-account:skt:list',       'Store',   2, 1, 1, NOW(), NOW()),
  (94035, 1, 94010, 94032, 'finance-pos-reconcile', '对账处理', 2, '/finance/bank-account/pos-account/reconcile', 'finance/bank-account/pos-account/reconcile-page', 'finance:bank-account:pos-account:reconcile:list', 'Scale',   3, 1, 1, NOW(), NOW()),
  (94036, 1, 94010, 94032, 'finance-pos-marks',     '标记与记录', 2, '/finance/bank-account/pos-account/marks',     'finance/bank-account/pos-account/marks-page',     'finance:bank-account:pos-account:mark:list',      'Tags',    4, 1, 1, NOW(), NOW()),
  -- API 闸门按钮（侧栏不可见；挂反代 /**）
  (94050, 1, 94010, 94032, 'finance-pos-access',    'POS对账接口访问', 3, NULL, NULL, 'finance:bank-account:pos-account:access', NULL, 90, 0, 1, NOW(), NOW()),
  -- legacy-auth/me：permission NULL → 注册表 authOnly（登录即可）
  (94028, 1, 94010, 94030, 'finance-legacy-auth-me', '遗留认证回查(authOnly)', 2, NULL, NULL, NULL, NULL, 99, 0, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = v.id)
  AND EXISTS (SELECT 1 FROM sys_app WHERE id = 94010);

-- ---------------------------------------------------------------------------
-- 3. sys_api：catalog + legacy-auth/me + 反代四方法 /**
-- ---------------------------------------------------------------------------
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.id, v.module_id, v.parent_id, v.code, v.type::sys_api_node_type, v.name, v.http_method, v.path_pattern, v.sort, v.status, v.created_at, v.updated_at
FROM (VALUES
  (94090, 94020, 0,     '0094',     'catalog', '财务辅助', NULL, NULL, 1, 1, NOW(), NOW()),
  (94100, 94020, 94090, '00940001', 'api', '遗留认证回查当前用户', 'GET',    '/api/v1/integration/legacy-auth/me', 1, 1, NOW(), NOW()),
  (94101, 94020, 94090, '00940002', 'api', 'POS对账反代 GET',     'GET',    '/api/v1/finance/bank-account/pos-account/**', 2, 1, NOW(), NOW()),
  (94102, 94020, 94090, '00940003', 'api', 'POS对账反代 POST',    'POST',   '/api/v1/finance/bank-account/pos-account/**', 3, 1, NOW(), NOW()),
  (94103, 94020, 94090, '00940004', 'api', 'POS对账反代 PUT',     'PUT',    '/api/v1/finance/bank-account/pos-account/**', 4, 1, NOW(), NOW()),
  (94104, 94020, 94090, '00940005', 'api', 'POS对账反代 DELETE',  'DELETE', '/api/v1/finance/bank-account/pos-account/**', 5, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (
    SELECT 1 FROM sys_api a
    WHERE a.type = 'api' AND a.status = 1
      AND a.http_method IS NOT DISTINCT FROM v.http_method
      AND a.path_pattern IS NOT DISTINCT FROM v.path_pattern
  )
  AND EXISTS (SELECT 1 FROM sys_module WHERE id = 94020);

-- ---------------------------------------------------------------------------
-- 4. sys_menu_api 绑定
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
  (94100, 94028, 94100, 1, NOW()),  -- legacy-auth/me → authOnly 菜单
  (94101, 94050, 94101, 1, NOW()),
  (94102, 94050, 94102, 2, NOW()),
  (94103, 94050, 94103, 3, NOW()),
  (94104, 94050, 94104, 4, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = v.menu_id)
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = v.api_id);

-- ---------------------------------------------------------------------------
-- 5. 授权租户管理员（role_id=1）
-- ---------------------------------------------------------------------------
INSERT INTO sys_role_permission (id, role_id, perm_type, target_id, created_at)
SELECT v.id, v.role_id, v.perm_type::sys_perm_type, v.target_id, v.created_at
FROM (VALUES
  (94030, 1, 'menu', 94030, NOW()),
  (94031, 1, 'menu', 94031, NOW()),
  (94032, 1, 'menu', 94032, NOW()),
  (94033, 1, 'menu', 94033, NOW()),
  (94034, 1, 'menu', 94034, NOW()),
  (94035, 1, 'menu', 94035, NOW()),
  (94036, 1, 'menu', 94036, NOW()),
  (94050, 1, 'menu', 94050, NOW()),
  (94028, 1, 'menu', 94028, NOW())
) AS v(id, role_id, perm_type, target_id, created_at)
WHERE NOT EXISTS (
  SELECT 1 FROM sys_role_permission rp
  WHERE rp.role_id = v.role_id AND rp.perm_type = v.perm_type::sys_perm_type AND rp.target_id = v.target_id
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 迁移后自检（人工）
--   SELECT id, code, name, portal_group, runtime FROM sys_app WHERE code='finance';
--   SELECT id, parent_id, name, type, path, permission, visible FROM sys_menu WHERE app_id=94010 ORDER BY id;
--   SELECT id, http_method, path_pattern FROM sys_api WHERE module_id=94020 ORDER BY id;
-- ---------------------------------------------------------------------------
