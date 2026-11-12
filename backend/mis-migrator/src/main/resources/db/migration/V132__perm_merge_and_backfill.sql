-- V132__perm_merge_and_backfill.sql
-- 权限合并（删 95007 + 95006 改 perm + 95007 的 sys_menu_api 改挂 95006）+ 流程分类端点登记 + wf_definition 数据回填
-- PostgreSQL 16
--
-- ## 决策 C 落地
--   删菜单 95007（流程编排），把 workflow:definition:edit 合并进 95006（流程定义）。
--   原 95007 上的 sys_menu_api（95032/95033/95050/95056）**改挂 95006（保留原 id）**，
--   以满足 V128 幂等契约（sys_menu_api 95050-95056 共 7 行）。
--   95030/95031 已在 95006（V123 原行），绝不重复绑定（否则违反 uk_menu_api_pair）。
--   流程分类 wf_category 的 6 个端点登记到 sys_api 95060-95065 并绑 95006（新 id 95080-95085）。
--   另：GET /form-definitions（api 95052）编排候选清单需要，在 95011 原绑之外**额外**补一份到 95006（id 95076）。
--
-- ## 关键顺序约束
--   uk_menu_app_permission 是 (app_id, permission) WHERE status=1 AND permission IS NOT NULL 的部分唯一索引。
--   95007 当前 permission='workflow:definition:edit'（status=1）。
--   若先 UPDATE 95006 成同一 permission 会立即违反唯一约束。
--   ⇒ **必须先改挂 95007 的 sys_menu_api 到 95006、再删 95007 菜单，最后才改 95006 的 permission**。
--
-- ## 数据回填
--   建默认「未分类」节点（id=990001，tenant=1），把历史 wf_definition.category_id 全部指向它；
--   旧 category VARCHAR 列保留不动（废弃，不再赋予业务含义）。
--
-- ## 幂等策略（对齐 V128 / V130 / V131）
--   * 固定 ID + WHERE NOT EXISTS(同 ID)  —— 防重复行
--   * AND NOT EXISTS(同 menu_id + api_id) —— 防「换 ID 重复插」（uk_menu_api_pair 兜底）
--   * AND EXISTS(菜单存在且启用) / AND EXISTS(端点存在) —— 外键目标前置校验
--   * 全程 NOW()，不用非确定函数
--   * UPDATE / DELETE 重复执行自然幂等
--
-- ## ID 段位（已核验，绝不与 V120~V131 冲突）
--   sys_menu_api  95030-95033（V123）、95050-95056（V128）已占；
--                本次取空闲段 95076（95052 额外绑定）、95080-95085（wf_category 端点绑定）
--
-- ⚠️ 绝不修改 V120~V131（checksum 变更会阻塞整条迁移链）。

-- ===========================================================================
-- 1) 流程分类端点 sys_api 登记（module_id=95010 任务流模块；parent_id=95010 catalog 节点）
--    路径为 BFF 对外路径（deny-unmapped:true 校验的是对外路径），与 mis-taskflow 内部
--    /internal/v1/workflow/categories/* 一一对应。
-- ===========================================================================
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
  (95060, 95010, 95010, 'wf_category_tree',   'api'::sys_api_node_type, '流程分类树',   'GET',    '/api/v1/workflow/categories/tree',       60, 1, NOW(), NOW()),
  (95061, 95010, 95010, 'wf_category_list',   'api'::sys_api_node_type, '流程分类列表', 'GET',    '/api/v1/workflow/categories',            61, 1, NOW(), NOW()),
  (95062, 95010, 95010, 'wf_category_create', 'api'::sys_api_node_type, '新增流程分类', 'POST',   '/api/v1/workflow/categories',            62, 1, NOW(), NOW()),
  (95063, 95010, 95010, 'wf_category_update', 'api'::sys_api_node_type, '更新流程分类', 'PUT',    '/api/v1/workflow/categories/{id:[0-9]+}', 63, 1, NOW(), NOW()),
  (95064, 95010, 95010, 'wf_category_delete', 'api'::sys_api_node_type, '删除流程分类', 'DELETE', '/api/v1/workflow/categories/{id:[0-9]+}', 64, 1, NOW(), NOW()),
  (95065, 95010, 95010, 'wf_category_get',    'api'::sys_api_node_type, '流程分类详情', 'GET',    '/api/v1/workflow/categories/{id:[0-9]+}', 65, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api a WHERE a.module_id = 95010 AND a.code = v.code)
  AND NOT EXISTS (
    SELECT 1 FROM sys_api a
    WHERE a.type = 'api' AND a.status = 1
      AND a.http_method = v.http_method AND a.path_pattern = v.path_pattern
  );

-- ===========================================================================
-- 2) 把 95007 的全部 sys_menu_api「改挂」95006（rebind，保留原 id：95032/95033/95050/95056）。
--    设计要点：是「rebind」而非「先删后插」——否则会破坏 V128 幂等契约
--    （MigrationIdempotencyIntegrationTest 断言 sys_menu_api 95050-95056 共 7 行）。
--    NOT EXISTS 兜底：若 95006 已存在同 (menu,api) 对则不重复（避免 uk_menu_api_pair 冲突）。
--    随后清掉 95007 的菜单授权与菜单本身（含其 permission='workflow:definition:edit' 行），
--    避免稍后 UPDATE 95006 成同一 permission 时撞 uk_menu_app_permission。
-- ===========================================================================
UPDATE sys_menu_api
SET menu_id = 95006
WHERE menu_id = 95007
  AND NOT EXISTS (
    SELECT 1 FROM sys_menu_api x
    WHERE x.menu_id = 95006 AND x.api_id = sys_menu_api.api_id
  );

DELETE FROM sys_role_permission WHERE perm_type = 'menu' AND target_id = 95007;

DELETE FROM sys_menu WHERE id = 95007;

-- ===========================================================================
-- 3) 权限合并：95006 的 permission 改为 workflow:definition:edit（合并 view/edit）
--    此刻 95007 已删，唯一约束不再冲突。
-- ===========================================================================
UPDATE sys_menu SET permission = 'workflow:definition:edit' WHERE id = 95006;

-- ===========================================================================
-- 4) 编排候选清单补绑：GET /form-definitions（api 95052）在 95011 原绑之外，
--    额外补一份到 95006（新 id 95076；95030/95031/95032/95033/95050/95056 已由第 2 步改挂，绝不重复）。
-- ===========================================================================
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
  (95076, 95006, 95052, 7, NOW())   -- 表单定义列表（GET /form-definitions，编排候选清单；95011 原绑保留）
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu_api ma WHERE ma.menu_id = v.menu_id AND ma.api_id = v.api_id)
  AND EXISTS (SELECT 1 FROM sys_menu m WHERE m.id = v.menu_id AND m.status = 1)
  AND EXISTS (SELECT 1 FROM sys_api a WHERE a.id = v.api_id);

-- ===========================================================================
-- 5) 流程分类端点 sys_menu_api 绑定（95060-95065 → 95006，新 id 95080-95085）
-- ===========================================================================
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
  (95080, 95006, 95060, 8,  NOW()),
  (95081, 95006, 95061, 9,  NOW()),
  (95082, 95006, 95062, 10, NOW()),
  (95083, 95006, 95063, 11, NOW()),
  (95084, 95006, 95064, 12, NOW()),
  (95085, 95006, 95065, 13, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu_api ma WHERE ma.menu_id = v.menu_id AND ma.api_id = v.api_id)
  AND EXISTS (SELECT 1 FROM sys_menu m WHERE m.id = v.menu_id AND m.status = 1)
  AND EXISTS (SELECT 1 FROM sys_api a WHERE a.id = v.api_id);

-- ===========================================================================
-- 6) 数据回填：默认「未分类」流程分类节点 + 历史 wf_definition 指向它
-- ===========================================================================
INSERT INTO wf_category (id, tenant_id, parent_id, code, name, description, sort_order, config, deleted, created_by, created_at, updated_at)
SELECT 990001, 1, 0, 'UNCATEGORIZED', '未分类', '系统默认分类：承接历史未归类流程定义', 0, '{}'::jsonb, 0, 1, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM wf_category WHERE id = 990001);

UPDATE wf_definition SET category_id = 990001 WHERE category_id IS NULL;

-- 自检（取消注释手动执行）：
-- SELECT id, code, name, http_method, path_pattern FROM sys_api WHERE id BETWEEN 95060 AND 95065 ORDER BY id;
-- SELECT ma.id, ma.menu_id, ma.api_id FROM sys_menu_api ma WHERE ma.api_id BETWEEN 95060 AND 95065 ORDER BY ma.id;
-- SELECT id, permission FROM sys_menu WHERE id = 95006;
-- SELECT count(*) AS orphan_defs FROM wf_definition WHERE deleted = 0 AND category_id IS NULL;
-- SELECT id, code, name FROM wf_category WHERE id = 990001;
-- SELECT count(*) FROM sys_menu_api WHERE id BETWEEN 95050 AND 95056;  -- 应为 7
