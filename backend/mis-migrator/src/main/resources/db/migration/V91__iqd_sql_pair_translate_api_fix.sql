-- ===========================================================================
-- V91__iqd_sql_pair_translate_api_fix.sql —— 补登被跳过的 sql-pairs/translate 端点
-- PostgreSQL 16 | 库名: mis_platform
-- 前置：V90 为最新；本文件为 V91，Flyway 只追加不修改已发布版本。
--
-- ---------------------------------------------------------------------------
-- 【修复背景 —— V76 与 V78 的 sys_api id 碰撞，导致 translate 端点漏登（F-1，P1）】
--   V76__agent_ops_feedback_submit_api.sql:32 与 V78__iqd_sql_pair_v110.sql:50
--   都向 sys_api 写入 **id = 92586**：
--     * V76:32 → POST /api/v1/agent-ops/sessions/{session_id}/feedback（code 00970001）
--     * V78:50 → POST /api/v1/iqd/sql-pairs/translate           （code 00960011）
--   且各自都带 `WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)`。
--
--   Flyway 严格按版本号顺序执行：**V76（76）先于 V78（78）**，V76 先占住 92586；
--   V78 执行时 `NOT EXISTS(id = 92586)` 为 false ⇒ translate 的 sys_api 行被
--   **静默跳过**（不报 PK 错，只是没插入）；同理 V78:68 的 sys_menu_api 绑定
--   **(id 92586, menu 92525, api 92586)** 也因 id 92586 已被 V76:49 占住而跳过。
--
--   结果：POST /api/v1/iqd/sql-pairs/translate **既无 sys_api 登记、也无菜单绑定**
--   ⇒ BFF `mis.api-permission.deny-unmapped=true`（application.yml 默认）⇒ 运行时 **40300**
--   ⇒ 前端「脱敏与维度 → 样本对 → 转化」（MR-08 的核心交互之一）**点了就报错**。
--   注：同批的 /sql-pairs/trial（V78:51，id 92587）**未被占用，登记正常** —— 仅 translate 受影响。
--
-- ---------------------------------------------------------------------------
-- 【约束：为何新增 V91 而不是改 V78 —— Flyway checksum】
--   V76 / V78 均已在真实环境执行过。Flyway 会校验「已应用迁移文件」的 checksum，
--   任何对 V76/V78 的字符级改动（哪怕只是换一个 id）都会使校验和不匹配 ⇒
--   `flyway migrate` 直接失败（Validate failed: Migration checksum mismatch）。
--   故 **V76 / V78 一字不动**，改用本新文件补登 —— 与 V51 的先例完全一致
--   （V51__agent_ops_skill_builder_chat_api_fix.sql 用同法修复过 V29/V46 争 92158
--   的同类缺陷；本文件即沿用该范式）。
--
-- ---------------------------------------------------------------------------
-- 【ID / code 段位（已全量 grep 确认空闲）】
--   92703   sys_api      接口行，code='00960011'，sort=11，父节点 92550
--   92704   sys_menu_api 绑定行 → menu 92525（权限由菜单侧 iqd:enhance:manage 提供）
--
--   * id 92703：V90 占用 sys_api 92700 + sys_menu_api 92701；92702 在 V90 注释里被
--     提及为「预留后续任务」（虽未实际使用），为**避开歧义**从 92703 起用。
--   * code '00960011'：**复用 V78 原意**。该 code 从未真正插入过（V78:50 那行被 id
--     守卫跳过），在 V8 建立的 `uk_api_module_code UNIQUE (module_id, code)` 下
--     module 92020 内确为空闲 ⇒ 复用可保持「这就是 V78 当初想插的那一行」的
--     可追溯性（换新号亦可，但会丢失这条线索）。
--   * 全仓 grep：92703 / 92704 / 00960011 均无其它命中（00960011 仅出现在 V78:50 的
--     被跳过行 + 其注释）。
--
-- ---------------------------------------------------------------------------
-- 【V8 已重构 sys_api（列清单务必对齐）】
--   V8__module_api_refactor.sql 已 `DROP COLUMN tenant_id / app_id`，并把唯一约束改为
--   `uk_api_module_code UNIQUE (module_id, code)`；另有**部分唯一索引**
--   `uk_api_method_path UNIQUE (http_method, path_pattern) WHERE type='api' AND status=1`。
--   ⇒ 本文件的 sys_api 列清单**没有** tenant_id / app_id（11 值 ↔ 12 列，与 V51/V81/V90 同）。
--   ⇒ sys_menu_api 仅有 `uk_menu_api_pair UNIQUE (menu_id, api_id)`（api_id 单列唯一已于 V8 放开）。
--
-- 【幂等】固定 ID + WHERE NOT EXISTS；三重去重：① id；② (module_id, code)（对齐真实唯一约束）；
--   ③ (http_method, path_pattern) WHERE type='api' AND status=1（对齐真实唯一索引）。
--   逐条 EXISTS 守卫父/菜单/接口存在。重复执行安全（第二次 3 个守卫全 false → 不插）。
--   ⚠️ 刻意**不**用「EXISTS(sys_module 92020)」兜 module 缺失：若模块不存在，FK
--   fk_api_module 会**报错中止迁移**（fail-loud 优于静默跳过 —— 正是本次 F-1 的教训）。
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. sys_api —— 补登 POST /api/v1/iqd/sql-pairs/translate（module 92020；id 92703）
-- ---------------------------------------------------------------------------
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (92703, 92020, 92550, '00960011', 'api'::sys_api_node_type, '样本对方言转化', 'POST', '/api/v1/iqd/sql-pairs/translate', 11, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api WHERE module_id = v.module_id AND code = v.code)
  AND NOT EXISTS (
    SELECT 1 FROM sys_api a
    WHERE a.type = 'api' AND a.status = 1
      AND a.http_method = v.http_method
      AND a.path_pattern = v.path_pattern
  )
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 92550);

-- ---------------------------------------------------------------------------
-- 2. sys_menu_api —— 绑定到菜单 92525（iqd:enhance:manage，与 V78:68 原意一致；id 92704）
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (92704, 92525, 92703, 1, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (
    SELECT 1 FROM sys_menu_api ma WHERE ma.menu_id = v.menu_id AND ma.api_id = v.api_id
  )
  AND EXISTS (SELECT 1 FROM sys_menu m WHERE m.id = v.menu_id)
  AND EXISTS (SELECT 1 FROM sys_api  a WHERE a.id = v.api_id);


-- ---------------------------------------------------------------------------
-- 迁移后自检（flyway migrate 后手工跑一遍；本沙箱无业务库，待真机执行）
--
--   -- 0) 全库 (method, path) 不应有重复（含与既有行比对）
--   SELECT http_method, path_pattern, COUNT(*) FROM sys_api
--   WHERE type = 'api' AND status = 1
--   GROUP BY http_method, path_pattern HAVING COUNT(*) > 1;
--   -- 期望：0 行
--
--   -- 1) 注册表视图：本端点应带非空 permission=iqd:enhance:manage
--   SELECT a.id, a.http_method, a.path_pattern, m.id AS menu_id, m.permission
--   FROM sys_api a
--   JOIN sys_menu_api ma ON ma.api_id = a.id
--   JOIN sys_menu m      ON ma.menu_id = m.id
--   WHERE a.id = 92703;
--   -- 期望：1 行，permission='iqd:enhance:manage'
--
--   -- 2) (module_id, code) 无重复
--   SELECT module_id, code, COUNT(*) FROM sys_api
--   WHERE module_id = 92020 AND code = '00960011' GROUP BY module_id, code HAVING COUNT(*) > 1;
--   -- 期望：0 行
--
--   -- 3) 回归：与 V76 的 92586（agent-ops feedback）并存不冲突
--   SELECT id, http_method, path_pattern FROM sys_api WHERE id IN (92586, 92703) ORDER BY id;
--   -- 期望：2 行（92586=feedback，92703=translate）
--
--   -- 4) 行为验收：无 iqd:enhance:manage 的登录用户
--   --    POST /api/v1/iqd/sql-pairs/translate 期望 403；有权限者期望 200/业务码。
--   --    BFF 需重启，或等 mis.api-permission.refresh-interval-seconds 到期重载注册表。
-- ---------------------------------------------------------------------------
