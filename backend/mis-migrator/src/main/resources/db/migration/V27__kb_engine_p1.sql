-- ===========================================================================
-- V27__kb_engine_p1.sql —— 知识库引擎策略 P1 公共地基
-- PostgreSQL 16 | 库名: mis_platform
-- 设计：docs/backend/mis-kb-engine-delete-p1-tasks.md（T0 公共地基）
-- 前置：V26__kb_engine_sync.sql（P0：kb_library 三列 + kb_engine_orphan + shedlock
--       + 权限码 kb:library:engine-ref:view / kb:engine:reconcile）
--
-- 内容五段：
--   A. kb_engine_orphan 增 4 列：resolved_action / resolved_at / resolved_note / resolved_by
--   B. kb_engine_rename_log 新表：存量 dataset 批量重命名的审计与回滚依据
--   C. 两个新权限码的菜单按钮节点（91058 / 91059）
--   D. 角色授权（role_id=1）
--   E. sys_api 6 行（91094-91099）+ sys_menu_api 关联（91100-91104）
--
-- ---------------------------------------------------------------------------
-- 【A 段：为什么 resolved 之外还要 resolved_action】
--   P0 的 resolved 只有 0/1，回答「处理了没有」；但 P1 的三种处置
--   （bind_existing 认领到已有库 / adopt_new 新建库认领 / ignore 标记忽略）
--   后果完全不同：前两者引擎 dataset 已被 MIS 接管，后者只是「不再提醒」。
--   对账 upsertOrphans 必须能区分——已被人工处置过（resolved_action IS NOT NULL）
--   的行不得被下一轮自动对账复位，否则运维刚点完「忽略」，下一分钟又冒出来。
--   这是 P0 遗留的坑（upsertOrphans 无条件按引擎侧可见性重写 resolved），
--   本列即修复该坑所需的判据。
--
-- 【B 段：为什么重命名必须落日志表】
--   批量改引擎侧 dataset 名是不可逆的外部副作用：引擎不保留改名历史。
--   一旦改错（比如分类名当时算错），没有日志就无法回滚。故每条 rename
--   （含 SKIP / FAILED）都落一行，按 batch_id 成组，回滚时反向执行
--   status=1（成功）的行：new_name → old_name。
--   operator_id 取 BFF 透传的 X-User-Id，满足高危操作可追责。
--
-- 【C 段：硬约束 —— uk_menu_app_permission（V17 r2 / V26 已两次踩过）】
--   V1__init_schema.sql:269
--     CREATE UNIQUE INDEX uk_menu_app_permission ON sys_menu (app_id, permission)
--       WHERE status = 1 AND permission IS NOT NULL;
--   每个权限码只建 1 行菜单（按钮节点 type=3）。
--   GET /kb/engine/orphans 是只读列表，与对账同源同风险级，直接复用 P0 的
--   kb:engine:reconcile（挂既有菜单 91057），**不新建菜单行**——新建就撞索引。
--
-- 【C 段：为什么不把「忽略/重命名」归到 kb:engine:reconcile】
--   后者是只读对账码。把写操作挂只读码 = 谁能看对账谁就能批量改引擎名，
--   风险面放大。故 orphan 处置、dataset 重命名各起独立高权限码。
--
-- 【E 段：ID / code 段位选取依据（全库实测 grep）】
--   sys_menu     91058 / 91059            —— 空闲
--   sys_api      91094 - 91099            —— 空闲（V26 用到 91079/91089/91090）
--   sys_menu_api 91100 - 91104            —— 空闲（V26 用到 91091-91093）
--   sys_api.code 段 00900001-00900012 由 V17/V18 占用、00900013-00900015 由 V26
--   占用，本文件取 00900016 - 00900021。
--
-- 【E 段：path_pattern 路径变量】
--   ApiPermissionRegistry 用 AntPathMatcher 匹配，V25/V26 已实测模板路径可命中，
--   故 '{nativeId}' / '{batchId}' 形态保留，无需退化成 query 参数写法。
--
-- 【schema 版本注意】V8__module_api_refactor.sql 已 DROP sys_api 的 tenant_id/app_id，
--   唯一约束 uk_api_module_code(module_id, code)、FK fk_api_module → sys_module(id)。
--   本文件 INSERT 列清单照 V26（V8 之后的 schema）。
--
-- 幂等：ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS /
--       固定 ID + WHERE NOT EXISTS + ON CONFLICT DO NOTHING，可重复执行。
-- 约束：不得修改已发布的 V12-V26。
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A. kb_engine_orphan 增列：承载 P1 的人工处置结果
-- ---------------------------------------------------------------------------
ALTER TABLE kb_engine_orphan ADD COLUMN IF NOT EXISTS resolved_action VARCHAR(16)  NULL;
ALTER TABLE kb_engine_orphan ADD COLUMN IF NOT EXISTS resolved_at     TIMESTAMPTZ  NULL;
ALTER TABLE kb_engine_orphan ADD COLUMN IF NOT EXISTS resolved_note   VARCHAR(512) NULL;
ALTER TABLE kb_engine_orphan ADD COLUMN IF NOT EXISTS resolved_by     BIGINT       NULL;

COMMENT ON COLUMN kb_engine_orphan.resolved_action IS '处置动作 bind_existing=认领到已有库 adopt_new=新建库认领 ignore=标记忽略；NULL=未经人工处置（可被对账自动复位）';
COMMENT ON COLUMN kb_engine_orphan.resolved_at     IS '人工处置时刻';
COMMENT ON COLUMN kb_engine_orphan.resolved_note   IS '处置备注；ignore 动作必填且 trim 后 >= 5 字';
COMMENT ON COLUMN kb_engine_orphan.resolved_by     IS '处置人用户 id（取 X-User-Id 透传头）';

-- 已处置列表按 resolved_at 倒序翻页，加个部分索引。
CREATE INDEX IF NOT EXISTS idx_kb_engine_orphan_action
    ON kb_engine_orphan (engine_type, resolved_action, resolved_at DESC)
    WHERE resolved_action IS NOT NULL;

-- ---------------------------------------------------------------------------
-- B. kb_engine_rename_log：存量 dataset 批量重命名的审计流水 + 回滚依据
--    一次 dry-run 或执行 = 一个 batch_id（UUID），组内每个库一行。
--    action：RENAME=实际改名 / SKIP=名称已规范无需改 / FAILED=引擎调用失败
--    status：0=未执行（dry-run 计划行） 1=成功 2=失败
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kb_engine_rename_log (
    id          BIGINT       PRIMARY KEY,
    batch_id    VARCHAR(40)  NOT NULL,               -- UUID，一次调用一个批次
    library_id  BIGINT       NOT NULL,
    engine_type VARCHAR(32)  NOT NULL,
    native_id   VARCHAR(64)  NOT NULL,               -- 引擎原生 dataset id
    old_name    VARCHAR(255) NOT NULL,               -- 改名前引擎侧实际名
    new_name    VARCHAR(255) NOT NULL,               -- 期望的规范名
    action      VARCHAR(16)  NOT NULL,               -- RENAME / SKIP / FAILED
    status      SMALLINT     NOT NULL DEFAULT 0,     -- 0=未执行 1=成功 2=失败
    error       VARCHAR(512) NULL,
    operator_id BIGINT       NULL,                   -- 取 X-User-Id 透传头
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  kb_engine_rename_log             IS '存量引擎 dataset 批量重命名流水（审计 + 按 batch_id 回滚依据）';
COMMENT ON COLUMN kb_engine_rename_log.batch_id    IS '批次号 UUID；dry-run 与执行各自独立批次';
COMMENT ON COLUMN kb_engine_rename_log.action      IS 'RENAME=已改名 SKIP=名称已规范 FAILED=引擎调用失败';
COMMENT ON COLUMN kb_engine_rename_log.status      IS '0=未执行(dry-run 计划) 1=成功 2=失败；回滚只处理 status=1';
COMMENT ON COLUMN kb_engine_rename_log.operator_id IS '操作人用户 id（X-User-Id 透传头）';

CREATE INDEX IF NOT EXISTS idx_erl_batch  ON kb_engine_rename_log (batch_id);
CREATE INDEX IF NOT EXISTS idx_erl_native ON kb_engine_rename_log (engine_type, native_id);

-- ---------------------------------------------------------------------------
-- C. 两个新权限码的菜单按钮节点（type=3），均挂「引擎配置」页 91038
--    91058 kb:engine:orphan:handle   —— 游离 dataset 处置（写）
--    91059 kb:engine:dataset:rename  —— 存量 dataset 批量重命名（高危写）
--    只读列表 GET /orphans 复用 P0 的 kb:engine:reconcile（菜单 91057），
--    这里不为它建菜单行（见文件头 C 段说明）。
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (91058, 1, 91010, 91038, 'kb_engine_orphan_handle',  '游离数据集处置', 3, NULL::VARCHAR, NULL::VARCHAR, 'kb:engine:orphan:handle',  NULL::VARCHAR, 2, 1, 1, NOW(), NOW()),
    (91059, 1, 91010, 91038, 'kb_engine_dataset_rename', '存量数据集改名', 3, NULL::VARCHAR, NULL::VARCHAR, 'kb:engine:dataset:rename', NULL::VARCHAR, 3, 1, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu WHERE app_id = v.app_id AND code = v.code)
  AND NOT EXISTS (SELECT 1 FROM sys_menu WHERE app_id = v.app_id AND permission = v.permission AND status = 1);

-- ---------------------------------------------------------------------------
-- D. 授权给内置租户管理员 role_id=1（口径与 V14/V17/V25/V26 一致，id = menu id）
-- ---------------------------------------------------------------------------
INSERT INTO sys_role_permission (id, role_id, perm_type, target_id, created_at)
SELECT m.id, 1, 'menu'::sys_perm_type, m.id, NOW()
FROM sys_menu m
WHERE m.id IN (91058, 91059)
  AND m.status = 1
  AND NOT EXISTS (
    SELECT 1 FROM sys_role_permission rp
    WHERE rp.role_id = 1 AND rp.perm_type = 'menu' AND rp.target_id = m.id
  )
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- E.1 sys_api 接口行（挂 V17 建的 catalog 91060「知识库工具」）
--     uk_api_method_path 是 (http_method, path_pattern) WHERE type='api' AND status=1
--     的部分唯一索引，故额外用 method+path 去重。
-- ---------------------------------------------------------------------------
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (91094, 91020, 91060, '00900016', 'api'::sys_api_node_type, '查看引擎游离数据集',   'GET',  '/api/v1/kb/engine/orphans',                          97,  1, NOW(), NOW()),
    (91095, 91020, 91060, '00900017', 'api'::sys_api_node_type, '处置引擎游离数据集',   'POST', '/api/v1/kb/engine/orphans/{nativeId}/resolve',       98,  1, NOW(), NOW()),
    (91096, 91020, 91060, '00900018', 'api'::sys_api_node_type, '存量数据集批量改名',   'POST', '/api/v1/kb/engine/datasets/rename',                  99,  1, NOW(), NOW()),
    (91097, 91020, 91060, '00900019', 'api'::sys_api_node_type, '存量数据集改名回滚',   'POST', '/api/v1/kb/engine/datasets/rename/rollback',         100, 1, NOW(), NOW()),
    (91098, 91020, 91060, '00900020', 'api'::sys_api_node_type, '查看改名批次列表',     'GET',  '/api/v1/kb/engine/datasets/rename/logs',             101, 1, NOW(), NOW()),
    (91099, 91020, 91060, '00900021', 'api'::sys_api_node_type, '查看改名批次明细',     'GET',  '/api/v1/kb/engine/datasets/rename/logs/{batchId}',   102, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api WHERE module_id = v.module_id AND code = v.code)
  AND NOT EXISTS (
    SELECT 1 FROM sys_api a
    WHERE a.type = 'api' AND a.status = 1
      AND a.http_method = v.http_method AND a.path_pattern = v.path_pattern
  )
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 91060);

-- ---------------------------------------------------------------------------
-- E.2 sys_menu_api 关联：接口 → 承载权限码的按钮节点
--     91094 → 91057（复用 P0 kb:engine:reconcile，只读列表）
--     91095 → 91058（kb:engine:orphan:handle）
--     91096/91097/91098/91099 → 91059（kb:engine:dataset:rename）
--     uk_menu_api_pair(menu_id, api_id) 守卫；V8 已 DROP uk_menu_api_api(api_id)。
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (91100, 91057, 91094, 3, NOW()),
    (91101, 91058, 91095, 1, NOW()),
    (91102, 91059, 91096, 1, NOW()),
    (91103, 91059, 91097, 2, NOW()),
    (91104, 91059, 91098, 3, NOW()),
    (91105, 91059, 91099, 4, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE menu_id = v.menu_id AND api_id = v.api_id)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = v.menu_id)
  AND EXISTS (SELECT 1 FROM sys_api  WHERE id = v.api_id);

-- ---------------------------------------------------------------------------
-- 迁移后自检（在你方环境执行 flyway migrate 后手工跑一遍）
--
--   -- 1) A 段四列存在
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'kb_engine_orphan'
--     AND column_name IN ('resolved_action','resolved_at','resolved_note','resolved_by');
--   -- 期望：4 行，全部 is_nullable = YES
--
--   -- 2) B 段表存在且两索引在
--   SELECT indexname FROM pg_indexes WHERE tablename = 'kb_engine_rename_log';
--   -- 期望：含 idx_erl_batch / idx_erl_native
--
--   -- 3) 权限码每个恰好 1 行（多于 1 行即违反 uk_menu_app_permission）
--   SELECT id, name, type, permission FROM sys_menu
--   WHERE app_id = 91010
--     AND permission IN ('kb:engine:orphan:handle','kb:engine:dataset:rename')
--     AND status = 1
--   ORDER BY id;
--   -- 期望：91058 | 游离数据集处置 | 3 | kb:engine:orphan:handle
--   --       91059 | 存量数据集改名 | 3 | kb:engine:dataset:rename
--
--   -- 4) 六条新接口在注册表联表查询里可见且 permission 正确
--   SELECT a.id, a.http_method, a.path_pattern, m.permission
--   FROM sys_api a
--   JOIN sys_menu_api ma ON ma.api_id = a.id
--   JOIN sys_menu m      ON ma.menu_id = m.id
--   WHERE a.id BETWEEN 91094 AND 91099
--   ORDER BY a.id;
--   -- 期望：
--   --   91094 GET  /api/v1/kb/engine/orphans                        | kb:engine:reconcile
--   --   91095 POST /api/v1/kb/engine/orphans/{nativeId}/resolve     | kb:engine:orphan:handle
--   --   91096 POST /api/v1/kb/engine/datasets/rename                | kb:engine:dataset:rename
--   --   91097 POST /api/v1/kb/engine/datasets/rename/rollback       | kb:engine:dataset:rename
--   --   91098 GET  /api/v1/kb/engine/datasets/rename/logs           | kb:engine:dataset:rename
--   --   91099 GET  /api/v1/kb/engine/datasets/rename/logs/{batchId} | kb:engine:dataset:rename
--
--   -- 5) 授权存在
--   SELECT * FROM sys_role_permission WHERE role_id = 1 AND target_id IN (91058, 91059);
--
--   -- 6) 行为验收：无 kb:engine:dataset:rename 的登录用户 POST
--   --    /api/v1/kb/engine/datasets/rename 期望 HTTP 403
--   --    （BFF 需重启或等注册表 refresh-interval-seconds=300s 到期重载）。
-- ---------------------------------------------------------------------------
