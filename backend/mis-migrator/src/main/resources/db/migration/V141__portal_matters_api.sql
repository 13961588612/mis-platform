-- V141__portal_matters_api.sql
-- 门户「待办事项 · 全部」聚合端点登记 + 绑定「我的待办」菜单 | PostgreSQL 16 | 幂等
--
-- ## 背景（对齐 docs/design/portal-matters-aggregation-design.md §5.2 / §6.3）
--   BFF 新增端点 `GET /api/v1/tasks/matters`（门户「全部」子 Tab：三源
--   UNION 聚合 + 服务端分页）。`application.yml` 的 `deny-unmapped:true` 要求
--   每个对外端点必须登记 `sys_api` 且绑定到 `status=1` 的菜单，否则静默 403（本仓老坑）。
--   既有三个端点（/tasks/my、/tasks/handled、/workflow/instances/my）本轮仅新增
--   可选 query 参数，method+path 未变 ⇒ **无需**重新登记。
--
-- ## ID 段位（实施前已核实为空闲，绝不与 V1~V139 冲突）
--   sys_api 95100 / sys_menu_api 95100 —— 95000-95099 段已全占用，95100 为最小空闲。
--
-- ## 绑定菜单 = 95002「我的待办」
--   95002 的 `status=1`（V123）且 `permission` 已被 V127 置 NULL ⇒ 注册表规则
--   `authOnly=true`（登录即可），与门户「全部事项」语义一致；该菜单已绑定
--   `/tasks/my`（sys_api 95025），本端点与之同菜单同语义。
--
-- ## 幂等策略（对齐 V123 / V139）
--   * sys_api：固定 id + NOT EXISTS(同 id) + NOT EXISTS(同 module_id+code)
--     + NOT EXISTS(同 type+status+method+path)
--   * sys_menu_api：固定 id + NOT EXISTS(同 id) + NOT EXISTS(menu_id,api_id)
--     + 外键目标前置 EXISTS（菜单启用 + api 存在）
--
-- ⚠️ 只追加；绝不修改 V1~V140。

-- ===========================================================================
-- 1) 端点登记 sys_api 95100（module_id=95010 任务流模块；parent_id=95010 catalog 节点）
-- ===========================================================================
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
  (95100, 95010, 95010, 'portal_matters', 'api'::sys_api_node_type, '我的全部事项', 'GET', '/api/v1/tasks/matters', 100, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api a WHERE a.module_id = 95010 AND a.code = v.code)
  AND NOT EXISTS (
    SELECT 1 FROM sys_api a
    WHERE a.type = 'api' AND a.status = 1
      AND a.http_method = v.http_method AND a.path_pattern = v.path_pattern
  );

-- ===========================================================================
-- 2) 绑定「我的待办」菜单 95002 ⇄ 95100
-- ===========================================================================
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
  (95100, 95002, 95100, 1, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu_api ma WHERE ma.menu_id = v.menu_id AND ma.api_id = v.api_id)
  AND EXISTS (SELECT 1 FROM sys_menu m WHERE m.id = v.menu_id AND m.status = 1)
  AND EXISTS (SELECT 1 FROM sys_api a WHERE a.id = v.api_id);

-- 自检（取消注释手动执行）：
-- SELECT id, module_id, code, http_method, path_pattern, status FROM sys_api WHERE id = 95100;
-- SELECT id, menu_id, api_id FROM sys_menu_api WHERE id = 95100;
