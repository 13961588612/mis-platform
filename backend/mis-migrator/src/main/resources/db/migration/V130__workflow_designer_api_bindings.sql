-- V130__workflow_designer_api_bindings.sql
-- 把「流程编排」所需的端点补绑到菜单 95007（permission = workflow:definition:edit）
-- PostgreSQL 16
--
-- ## 为什么需要它
--
-- 第 4 批前端改造把编排页从独立路由改成**流程定义列表页内的全屏 Dialog**
-- （`definitions-page.tsx` 宿主 + `DesignerDialog` / `DesignerBody`）。
-- 改造后，一个**只持有 `workflow:definition:edit`**（菜单 95007）而**没有**
-- `workflow:definition:view`（菜单 95006）的账号，编排全流程会断在两处：
--
--   1. 打开编排 Dialog ⇒ `form-catalog.ts` 拉「表单候选清单」
--      `GET /api/v1/form-definitions?status=ENABLED`（sys_api 95052）
--      —— 95052 只绑在「表单注册」95011 ⇒ 403 ⇒ 前端只能走降级分支
--      （回退到前端加载表全量 code + 黄色告示），拿不到「后端启用 ∧ 前端有实现」的交集。
--   2. 编辑已有定义 ⇒ `designer-body.tsx` 调 `GET /api/v1/workflow/definitions/{id}`
--      还原 nodes/edges（sys_api 95031）—— 95031 只绑在 95006 ⇒ 403 ⇒ 画布空白。
--
-- 外加一处同源缺口：编排路由 `/system/workflow/designer` 现在 **redirect 进列表页**，
-- 且保存成功后 `onDesignerSaved` 会刷新列表 ⇒ 需要
-- `GET /api/v1/workflow/definitions`（sys_api 95030），它同样只绑在 95006。
--
-- 根因（与 V128 同源）：`mis-admin-bff/application.yml` 的
-- `mis.security.api-permission.deny-unmapped: true` ⇒ 端点必须绑在**当前用户已授权**
-- 的菜单上才不 403。这是「漏登记 / 错绑 sys_api」这个坑的第 5 次变体。
--
-- ## 修法：只**追加**绑定，不动任何历史行
--
-- `sys_menu_api` 的唯一约束是 `uk_menu_api_pair (menu_id, api_id)`（已核验），
-- **不含 api_id 单列** ⇒ 同一个端点绑多个菜单是合法的。
-- 因此 95052 在 95011 上的原有绑定**保留**（表单注册页仍要用它），
-- 只在 95007 上**新增一行**；95030/95031 同理，95006 上的绑定不动。
--
-- ## 幂等策略（对齐 V128 / V129）
--
--   * 固定 ID + `WHERE NOT EXISTS (同 ID)`  —— 防重复行
--   * `AND NOT EXISTS (同 menu_id + api_id)` —— 防「换 ID 重复插」（唯一约束兜底）
--   * `AND EXISTS (菜单存在且启用)` / `AND EXISTS (端点存在)` —— 外键目标前置校验，
--     目标缺失时**跳过而不是插脏数据**
--   * 全程 `NOW()`，不用非确定函数
--
-- ## ID 段位（已核验）
--
--   sys_menu_api  95030-95033（V123）、95050-95056（V128）已占；
--                 **95057-95099 实测 0 行 + 全量迁移文件 grep 无引用** ⇒ 本次取 95057-95059
--   sort          95007 现有绑定已用 1-4（95032/95033/95050/95056）⇒ 本次续 5-7
--
-- ⚠️ 绝不修改 V120~V129（checksum 变更会阻塞整条迁移链）。

-- ===========================================================================
-- 1) 菜单 95007「流程编排」⇄ API 补绑
--
--    编排全流程实际用到的端点（来源：前端代码 + 现状核对）：
--
--      sys_api  端点                                            改动前          本次
--      ------  ----------------------------------------------  --------------  ------
--      95030   GET  /api/v1/workflow/definitions              95006           补绑 95007
--      95031   GET  /api/v1/workflow/definitions/{id}         95006           补绑 95007
--      95032   POST /api/v1/workflow/definitions              95007 ✓已有     跳过
--      95033   POST /api/v1/workflow/definitions/{id}/activate 95007 ✓已有     跳过
--      95050   POST /api/v1/workflow/definitions/{id}/deactivate 95007 ✓已有   跳过
--      95056   PUT  /api/v1/workflow/definitions/{id}         95007 ✓已有     跳过
--      95052   GET  /api/v1/form-definitions                  95011           补绑 95007
--
--    ⚠️ 刻意**不**补绑 95051（表单定义树）/ 95053-95055（表单 CRUD）：
--       编排页只用列表接口取候选 code（`fetchEnabledFormDefinitions`），
--       树与增删改是「表单注册」页（95011）的活，绑过来等于把表单管理权
--       白送给只该有编排权的人 —— 那是越权，不是补漏。
-- ===========================================================================
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
  (95057, 95007, 95030, 5, NOW()),   -- 流程定义列表（Dialog 宿主列表页 + 保存后刷新）
  (95058, 95007, 95031, 6, NOW()),   -- 流程定义详情（编辑态还原 nodes/edges）
  (95059, 95007, 95052, 7, NOW())    -- 表单定义列表（编排页表单候选清单）
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu_api ma WHERE ma.menu_id = v.menu_id AND ma.api_id = v.api_id)
  AND EXISTS (SELECT 1 FROM sys_menu m WHERE m.id = v.menu_id AND m.status = 1)
  AND EXISTS (SELECT 1 FROM sys_api a WHERE a.id = v.api_id);

-- 自检（取消注释手动执行）：
-- SELECT ma.id, ma.menu_id, ma.api_id, a.http_method, a.path_pattern
-- FROM sys_menu_api ma JOIN sys_api a ON a.id = ma.api_id
-- WHERE ma.menu_id = 95007 ORDER BY ma.sort;
