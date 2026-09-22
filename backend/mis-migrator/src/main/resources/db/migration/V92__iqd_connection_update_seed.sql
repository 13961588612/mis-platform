-- ===========================================================================
-- V92__iqd_connection_update_seed.sql —— 建模台「按 id 更新连接」端点登记
--                                        （v1.11 / T06）
-- PostgreSQL 16 | 库名: mis_platform
-- 前置：V89（MCP 端点 92650-92655 / 绑定 92657-92662，code 至 00960043）；
--       V90（PUT /catalog/cube，sys_api 92700 + sys_menu_api 92701，code 00960044）；
--       V91（补登 POST /sql-pairs/translate，sys_api 92703 + sys_menu_api 92704）为最新。
--
-- 内容（1 条 sys_api + 1 条 sys_menu_api）：
--   PUT /api/v1/iqd/connections/{id}  → iqd:modeling:edit（与 POST /connections 同权限码）
--
-- ⚠️ V87 / V88 / V89 / V90 / V91 **一字不动**（Flyway checksum：改已应用迁移会阻塞整条迁移链）。
--
-- 为什么需要这个端点（T06）
-- ------------------------
-- 唯一写通道 `PUT /api/v1/iqd/config`（IqdController:49）是「单条主连接 upsert」（一期形态）：
-- 面对「已有连接 N 条 + per-connection MCP 状态卡」时，「停用 / 编辑**指定**连接」无精确指向。
-- 本端点补「按 id 精确更新一条既有连接」（局部更新：缺省/null = 保留原值）；
-- 与 `PUT /config` **并存、本期不收敛**（语义正交，见 system-design §14.2）。
--
-- 段位（已全量 grep 核实空闲）：
--   sys_api      ：…至 92703（V91）→ 本文件取 92800（928xx 段全空闲，已用至 92704）
--   sys_menu_api ：…至 92704（V91）→ 本文件取 92801
--   sys_api code ：module 92020 下至 00960044（V90）→ 续 00960045
--
-- 硬规则（同 V72-V91）：每个 /api/v1/iqd/** 端点必须**同时**写 sys_api + sys_menu_api
-- （BFF 注册表 = sys_api ⋈ sys_menu_api ⋈ sys_menu INNER JOIN；deny-unmapped=true 时只插一个表
-- → 40300「接口未授权映射」）。`/internal/v1/**` 一律不登记（无 MIS JWT，登记反 401）。
--
-- 权限码选择：iqd:modeling:edit（与 POST /connections 一致 —— 同属「建模台编辑连接配置」，
-- 校验码与 mis-iqd `@PreAuthorize("hasAuthority('iqd:modeling:edit')")` 逐条对齐）。
-- 挂菜单 92632（V87 的 iqd-modeling-edit 权限按钮），与 POST /connections 同菜单。
-- ⚠️ 不可照抄同卡片 ConnectionWizard 的 iqd:mcp:manage（92656，进程操作）—— 照抄会「前端放行、后端 40300」。
--
-- 路径模板 {id} 说明：`{id}` 为 AntPathMatcher 模板变量（ApiPermissionRegistry 用 pathMatcher.match），
-- 只匹配**恰好一段** ⇒ 不会吞掉 `/{id}/test`（后者 method=POST 且多一段），也不会匹配无 id 的
-- `PUT /api/v1/iqd/connections`（→ 仍未映射 → 40300，符合预期）。
--
-- 【V8 已重构 sys_api（列清单务必对齐）】
--   V8__module_api_refactor.sql 已 `DROP COLUMN tenant_id / app_id`，并把唯一约束改为
--   `uk_api_module_code UNIQUE (module_id, code)`；另有**部分唯一索引**
--   `uk_api_method_path UNIQUE (http_method, path_pattern) WHERE type='api' AND status=1`。
--   ⇒ 本文件的 sys_api 列清单**没有** tenant_id / app_id（11 值 ↔ 12 列，与 V51/V81/V90/V91 同）。
--   ⇒ sys_menu_api 仅有 `uk_menu_api_pair UNIQUE (menu_id, api_id)`（api_id 单列唯一已于 V8 放开）。
--
-- 【幂等】固定 ID + WHERE NOT EXISTS；三重去重 + 逐条 EXISTS，**各自对齐一个真实唯一约束**：
--   ① sys_api.id            → 主键 PK
--   ② (module_id, code)     → uk_api_module_code UNIQUE(module_id, code)
--   ③ (http_method, path)   → uk_api_method_path partial index WHERE type='api' AND status=1
--   sys_menu_api：① id（PK）② (menu_id, api_id) → uk_menu_api_pair
--   ⚠️ 刻意**不**用「EXISTS(sys_module 92020)」兜 module 缺失：若模块不存在，FK
--   fk_api_module 会**报错中止迁移**（fail-loud 优于静默跳过 —— 静默跳过正是 V76/V78 争 92586
--   导致 translate 漏登（F-1）的病根，见 architecture.md §7.10 与 V91 结论）。
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. sys_api —— PUT /api/v1/iqd/connections/{id}（module 92020；code 00960045；id 92800）
-- ---------------------------------------------------------------------------
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (92800, 92020, 92550, '00960045', 'api'::sys_api_node_type, '建模台-更新连接', 'PUT', '/api/v1/iqd/connections/{id}', 45, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)                                    -- ① PK
  AND NOT EXISTS (SELECT 1 FROM sys_api a WHERE a.module_id = v.module_id AND a.code = v.code) -- ② uk_api_module_code
  AND NOT EXISTS (
    SELECT 1 FROM sys_api a
    WHERE a.type = 'api' AND a.status = 1
      AND a.http_method = v.http_method
      AND a.path_pattern = v.path_pattern
  )                                                                                          -- ③ uk_api_method_path
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 92550);                                        -- 父节点存在

-- ---------------------------------------------------------------------------
-- 2. sys_menu_api —— 绑定到 92632（iqd:modeling:edit，与 POST /connections 同菜单；id 92801）
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (92801, 92632, 92800, 1, NOW())    -- PUT /connections/{id} → iqd:modeling:edit
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)                                   -- ① PK
  AND NOT EXISTS (
    SELECT 1 FROM sys_menu_api ma WHERE ma.menu_id = v.menu_id AND ma.api_id = v.api_id
  )                                                                                             -- ② uk_menu_api_pair
  AND EXISTS (SELECT 1 FROM sys_menu m WHERE m.id = v.menu_id AND m.status = 1)                  -- 菜单存在且启用
  AND EXISTS (SELECT 1 FROM sys_api  a WHERE a.id = v.api_id);                                    -- 接口存在

-- ---------------------------------------------------------------------------
-- 迁移后自检（flyway migrate 后手工跑一遍；本沙箱无业务库，待真机执行）
--
--   -- 1) 端点 + 绑定（期望 1 行；PUT /api/v1/iqd/connections/{id}，permission=iqd:modeling:edit）
--   SELECT a.id, a.http_method, a.path_pattern, m.id AS menu_id, m.permission
--   FROM sys_api a
--   JOIN sys_menu_api ma ON ma.api_id = a.id
--   JOIN sys_menu m      ON ma.menu_id = m.id
--   WHERE a.id = 92800;
--   -- 期望：1 行，permission='iqd:modeling:edit'
--
--   -- 2) 同路径不同方法并存（期望 2 行：POST 92601 + PUT 92800，同一 path_pattern 不同 method）
--   SELECT id, http_method, path_pattern FROM sys_api
--   WHERE path_pattern = '/api/v1/iqd/connections' OR path_pattern = '/api/v1/iqd/connections/{id}'
--   ORDER BY http_method;
--
--   -- 3) 前序段计数不变（期望 12 / 5 / 6 / 1 / 1）
--   SELECT COUNT(*) AS v87_apis FROM sys_api      WHERE id BETWEEN 92601 AND 92612;
--   SELECT COUNT(*) AS v88_apis FROM sys_api      WHERE id BETWEEN 92640 AND 92644;
--   SELECT COUNT(*) AS v89_apis FROM sys_api      WHERE id BETWEEN 92650 AND 92655;
--   SELECT COUNT(*) AS v90_apis FROM sys_api      WHERE id BETWEEN 92700 AND 92700;
--   SELECT COUNT(*) AS v91_apis FROM sys_api      WHERE id BETWEEN 92703 AND 92703;
--
--   -- 4) 全库 (method, path) 不应有重复（含与既有行比对）
--   SELECT http_method, path_pattern, COUNT(*) FROM sys_api
--   WHERE type = 'api' AND status = 1
--   GROUP BY http_method, path_pattern HAVING COUNT(*) > 1;
--   -- 期望：0 行
--
--   -- 5) (module_id, code) 无重复
--   SELECT module_id, code, COUNT(*) FROM sys_api
--   WHERE module_id = 92020 AND code = '00960045' GROUP BY module_id, code HAVING COUNT(*) > 1;
--   -- 期望：0 行
-- ---------------------------------------------------------------------------
