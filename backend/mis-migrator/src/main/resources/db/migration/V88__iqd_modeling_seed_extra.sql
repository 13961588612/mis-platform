-- ===========================================================================
-- V88__iqd_modeling_seed_extra.sql —— 可视化建模台 端点补登（v1.11 / T02a 收尾）
-- PostgreSQL 16 | 库名: mis_platform
-- 前置：V87（建模台主页 92600 / 权限码按钮 92631-92633 / 12 条 sys_api 92601-92612 +
--       sys_menu_api 92613-92624 / sys_role_permission 92625-92627）；V81（code 段 00960016）；
--       V84（code 段至 00960020）；V87（code 段至 00960032）
--
-- 内容（5 条 sys_api + 5 条 sys_menu_api）：
--   1. GET  /api/v1/iqd/connections                              → iqd:modeling:view  （T02a 已实现，阻塞 M-G1）
--   2. GET  /api/v1/iqd/modeling/layout/{connId}                 → iqd:modeling:view  （T03）
--   3. PUT  /api/v1/iqd/modeling/layout/{connId}                 → iqd:modeling:edit  （T03）
--   4. POST /api/v1/iqd/modeling/layout/{connId}/auto-layout     → iqd:modeling:edit  （T03）
--   5. GET  /api/v1/iqd/dependencies                             → iqd:modeling:view  （T03）
--
-- ⚠️ V87 **一字不动**（已过 arity 静态校验，降回归风险）；本文件只做增量补登。
--
-- 为什么需要这个文件
-- ------------------
-- V87 的 12 条 sys_api 覆盖了「8 建模台 + 4 表发现」，但漏了 4 类路径：
--   * `GET /connections`         —— T02a 已实现，却未登记 ⇒ deny-unmapped 下**必然 40300**，
--                                   建模台主页/连接向导拿不到连接列表（阻塞 M-G1 展示）；
--   * layout GET/PUT/auto-layout —— MR-S4 画布持久化（T03）；
--   * `GET /dependencies`        —— 引用阻断/依赖提示区（T03）。
-- 本次一次性补齐，使 T03 落地时**无需再动种子**。
--
-- 段位（已 grep 全仓核实 92640-92649 空闲）：
--   sys_api      ：92550-92612 已用（V72/V73/V74/V78/V81/V84/V87）→ 本文件取 92640-92644
--   sys_menu_api ：92551-92624 已用                                → 本文件取 92645-92649
--   sys_api code ：module 92020 下至 00960032 已用（V87）           → 续 00960033-00960037
--   （92628-92630 / 92634-92639 亦空闲，预留后续任务，本文件不使用）
--
-- 硬规则（同 V72-V87）：每个 /api/v1/iqd/** 端点必须**同时**写 sys_api + sys_menu_api
-- （BFF 注册表 = sys_api ⋈ sys_menu_api ⋈ sys_menu INNER JOIN；deny-unmapped=true 时只插一个表
-- → 40300「接口未授权映射」，V61 教训）。`/internal/v1/**` 一律不登记（无 MIS JWT，登记反 401）。
--
-- 占位符说明：AntPathMatcher 把 `{name}` 当「匹配单段」的模板变量，**变量名不参与匹配**
-- （V87 已用 sys_api `{id}` ↔ 控制器 `{connectionId}` 共存验证过）。此处统一写 `{connId}`
-- 以贴近 system-design §3.3 的 `/modeling/layout/{connectionId}` 语义，不影响命中。
--
-- 幂等：固定 ID + WHERE NOT EXISTS + (method,path) 去重；append-only，可安全重跑。
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. sys_api —— 5 条端点（module 92020；code 00960033-00960037）
-- ---------------------------------------------------------------------------
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (92640, 92020, 92550, '00960033', 'api'::sys_api_node_type, '建模台-连接清单',        'GET',  '/api/v1/iqd/connections',                            33, 1, NOW(), NOW()),
    (92641, 92020, 92550, '00960034', 'api'::sys_api_node_type, '建模台-取布局',          'GET',  '/api/v1/iqd/modeling/layout/{connId}',            34, 1, NOW(), NOW()),
    (92642, 92020, 92550, '00960035', 'api'::sys_api_node_type, '建模台-保存布局',        'PUT',  '/api/v1/iqd/modeling/layout/{connId}',            35, 1, NOW(), NOW()),
    (92643, 92020, 92550, '00960036', 'api'::sys_api_node_type, '建模台-一键自动布局',    'POST', '/api/v1/iqd/modeling/layout/{connId}/auto-layout', 36, 1, NOW(), NOW()),
    (92644, 92020, 92550, '00960037', 'api'::sys_api_node_type, '建模台-依赖方清单',      'GET',  '/api/v1/iqd/dependencies',                        37, 1, NOW(), NOW())
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
-- 2. sys_menu_api —— 5 条绑定（menu_id ∈ {92631 view, 92632 edit}）
--
--    权限码选择（与 mis-iqd `@PreAuthorize` 逐条对齐，避免「BFF 放行、下游 40300」错配）：
--      * GET  /connections                → 92631 view：主页准入码即 view（§3.2「无 view 不可进页面」），
--        而页面一进就要拉连接列表渲染连接选择器/MCP 状态卡；若要求 edit，
--        只有 view 的用户「进得去页面却拿不到列表」→ 页面半残。
--        读语义接口用 view，与 §3.3 的 GET /dependencies → view 同口径；凭证不回显（恒 ******）。
--      * GET  /modeling/layout/{connId}   → 92631 view（§3.3 明示 iqd:modeling:view）
--      * PUT  /modeling/layout/{connId}   → 92632 edit（§3.3 明示 iqd:modeling:edit；拖拽即写库）
--      * POST .../auto-layout             → 92632 edit（§3.3 明示 iqd:modeling:edit）
--      * GET  /dependencies               → 92631 view（§3.3 明示 iqd:modeling:view）
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (92645, 92631, 92640, 1, NOW()),   -- GET  /connections                          → iqd:modeling:view
    (92646, 92631, 92641, 1, NOW()),   -- GET  /modeling/layout/{connId}              → iqd:modeling:view
    (92647, 92632, 92642, 1, NOW()),   -- PUT  /modeling/layout/{connId}              → iqd:modeling:edit
    (92648, 92632, 92643, 1, NOW()),   -- POST /modeling/layout/{connId}/auto-layout  → iqd:modeling:edit
    (92649, 92631, 92644, 1, NOW())    -- GET  /dependencies                          → iqd:modeling:view
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (
    SELECT 1 FROM sys_menu_api ma WHERE ma.menu_id = v.menu_id AND ma.api_id = v.api_id
  )
  AND EXISTS (SELECT 1 FROM sys_menu m WHERE m.id = v.menu_id AND m.status = 1)
  AND EXISTS (SELECT 1 FROM sys_api  a WHERE a.id = v.api_id);

-- ---------------------------------------------------------------------------
-- 迁移后自检（取消注释执行；不在迁移中运行）
--
--   -- 1) 端点 + 绑定（期望 5 行；permission 为 view/edit）
--   SELECT a.id, a.http_method, a.path_pattern, m.id AS menu_id, m.permission
--   FROM sys_api a
--   JOIN sys_menu_api ma ON ma.api_id = a.id
--   JOIN sys_menu m      ON ma.menu_id = m.id
--   WHERE a.id BETWEEN 92640 AND 92644
--   ORDER BY a.sort;
--
--   -- 2) 期望：GET/connections=view, layout GET=view, layout PUT=edit, auto-layout=edit, dependencies=view
--   SELECT COUNT(*) AS bound FROM sys_api a JOIN sys_menu_api ma ON ma.api_id = a.id
--   WHERE a.id BETWEEN 92640 AND 92644;
--
--   -- 3) V87 未受影响（应仍为 12）
--   SELECT COUNT(*) AS v87_apis FROM sys_api WHERE id BETWEEN 92601 AND 92612;
-- ---------------------------------------------------------------------------
