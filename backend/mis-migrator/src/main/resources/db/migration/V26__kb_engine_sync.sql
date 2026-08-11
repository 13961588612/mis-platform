-- ===========================================================================
-- V26__kb_engine_sync.sql —— 知识库「引擎同步状态 + 归档标记 + 对账」数据地基
-- PostgreSQL 16 | 库名: mis_platform
-- 设计：docs/backend/mis-kb-engine-delete-p0-tasks.md（T01 契约与数据地基）
--
-- 内容四段：
--   A. kb_library 增列：engine_sync_status / engine_checked_at / archived_at
--   B. kb_engine_orphan 新表：记录「引擎有 / MIS 无」的游离 dataset
--   C. shedlock 新表：定时对账任务的多实例互斥锁（ShedLock JdbcTemplateLockProvider）
--   D. 两个新权限码的菜单节点 + 角色授权 + sys_api + sys_menu_api 登记
--
-- ---------------------------------------------------------------------------
-- 【A 段：为什么要 archived_at】
--   原口径「归档 = status=0 + 归档标记」没说标记落在哪。光靠 status=0 分不清
--   「停用」（PUT /libraries/{id} status=0，可随时恢复、引擎名不变）与
--   「归档」（DELETE ?mode=archive，引擎侧已改名为 [已归档-yyyyMMdd]-xxx）。
--   两者的引擎侧状态完全不同，对账时期望名也不同（见 KbEngineReconcileService），
--   必须有独立标记：归档判定 = status = 0 AND archived_at IS NOT NULL。
--   LibraryStatus 枚举保持 0/1 不动，不引入第三个 status 值（避免全量改判空处）。
--
-- 【A 段：engine_sync_status 码值】
--   0 = 未知（未对过账，建库默认值）
--   1 = 一致
--   2 = 引擎缺失（MIS 有 / 引擎无 → 孤儿引用）
--   3 = 名称漂移 / 引擎同步失败（update 引擎调用失败、archive 改名失败也写 3）
--   「引擎有 / MIS 无」这类差异无行可落，写 B 段的 kb_engine_orphan。
--
-- 【D 段：ID / code 段位选取依据（全库实测）】
--   已占用 91xxx：91001-91005, 91010, 91020, 91030-91055, 91060-91078, 91080-91088
--   本文件取实测空闲位：
--     * sys_menu     91056 / 91057
--     * sys_api      91079 / 91089 / 91090
--     * sys_menu_api 91091 / 91092 / 91093
--   sys_api.code 段 00900001-00900012 已被 V17/V18 占用，本文件取 00900013-00900015。
--   （任务分解原文建议的 91062/91063/91064 已被 V18__kb_synonym.sql 占用，
--     照抄会被 WHERE NOT EXISTS 守卫静默跳过 → 登记白做，故此处改用空闲段。）
--
-- 【D 段：硬约束 —— uk_menu_app_permission（V17 r2 的血教训）】
--   V1__init_schema.sql:269
--     CREATE UNIQUE INDEX uk_menu_app_permission ON sys_menu (app_id, permission)
--       WHERE status = 1 AND permission IS NOT NULL;
--   同一 app 下**不得两行共用同一 permission**。故本文件每个权限码只建 1 行菜单
--   （按钮节点 type=3），绝不再叠加「页面菜单也挂同一码」的写法。
--
-- 【D 段：为什么必须登记 sys_api / sys_menu_api】
--   BFF 的 api-permission.deny-unmapped=false（未映射即放行）。不登记 =
--   任何登录用户都能直接调这两组接口，权限码只管菜单显隐。
--   Q4「有限暴露 dataset_id」本身就是破 F8 红线换来的，登记 + 审计一个都不能少。
--
-- 【D 段：path_pattern 支持路径变量（本次已核实）】
--   ApiPermissionRegistry 用 AntPathMatcher 做匹配，V25 已实测登记
--   '/api/v1/kb/categories/{id}/admins' 这类模板路径可正常命中，
--   故 engine-ref 端点保留 '/api/v1/kb/libraries/{id}/engine-ref' 形态，
--   无需退化成 '?libraryId=' 的无路径变量写法。
--
-- 【schema 版本注意】V8__module_api_refactor.sql 已 DROP sys_api 的 tenant_id / app_id，
--   唯一约束改为 uk_api_module_code(module_id, code)、新增 FK fk_api_module → sys_module(id)。
--   本文件 INSERT 列清单照 V17/V25（V8 之后的 schema），不是 V2/V6 的旧写法。
--
-- 幂等：ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS /
--       固定 ID + WHERE NOT EXISTS + ON CONFLICT DO NOTHING，可重复执行。
-- 约束：不得修改已发布的 V12-V25。
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A. kb_library 增列
-- ---------------------------------------------------------------------------
ALTER TABLE kb_library ADD COLUMN IF NOT EXISTS engine_sync_status SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE kb_library ADD COLUMN IF NOT EXISTS engine_checked_at  TIMESTAMPTZ NULL;
ALTER TABLE kb_library ADD COLUMN IF NOT EXISTS archived_at        TIMESTAMPTZ NULL;

COMMENT ON COLUMN kb_library.engine_sync_status IS '引擎同步状态 0=未知 1=一致 2=引擎缺失 3=名称漂移或同步失败';
COMMENT ON COLUMN kb_library.engine_checked_at  IS '最近一次与引擎对账/同步的时刻';
COMMENT ON COLUMN kb_library.archived_at        IS '归档时刻；归档判定 = status=0 AND archived_at IS NOT NULL';

-- 对账服务按 engine_library_ref 非空扫全量，加个部分索引避免全表扫。
CREATE INDEX IF NOT EXISTS idx_kb_library_engine_ref
    ON kb_library (engine_library_ref)
    WHERE engine_library_ref IS NOT NULL;

-- ---------------------------------------------------------------------------
-- B. kb_engine_orphan：引擎侧存在但 MIS 无对应知识库的游离 dataset
--    P0 只做「发现与展示」，认领/清理操作页归 P1（resolved / note 两列先预留）。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kb_engine_orphan (
    id            BIGINT PRIMARY KEY,
    engine_type   VARCHAR(32)  NOT NULL,
    native_id     VARCHAR(64)  NOT NULL,          -- 引擎原生 dataset id
    native_name   VARCHAR(255) NULL,              -- 引擎侧 dataset 名（快照，可能随对账刷新）
    doc_count     INT          NULL,              -- 引擎侧文档数（快照）
    first_seen_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    last_seen_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    resolved      SMALLINT     NOT NULL DEFAULT 0,  -- 0=待处理 1=已认领/已处理（P1 用）
    note          VARCHAR(512) NULL,
    CONSTRAINT uk_kb_engine_orphan UNIQUE (engine_type, native_id)
);

COMMENT ON TABLE  kb_engine_orphan            IS '引擎侧游离 dataset（引擎有 / MIS 无），由定时对账 upsert';
COMMENT ON COLUMN kb_engine_orphan.first_seen_at IS '首次发现时刻，后续对账不覆盖';
COMMENT ON COLUMN kb_engine_orphan.last_seen_at  IS '最近一次对账仍然可见的时刻';

CREATE INDEX IF NOT EXISTS idx_kb_engine_orphan_resolved
    ON kb_engine_orphan (resolved, last_seen_at DESC);

-- ---------------------------------------------------------------------------
-- C. shedlock：定时对账的分布式锁表
--    列名/类型固定为 ShedLock JdbcTemplateLockProvider 的约定，不能改名。
--    mis-kb 自己没有 Flyway（src/main/resources 只有 application.yml / bootstrap.yml），
--    故建在 mis-migrator。lock name 只有一个：kb-engine-reconcile。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shedlock (
    name       VARCHAR(64)  PRIMARY KEY,
    lock_until TIMESTAMPTZ  NOT NULL,
    locked_at  TIMESTAMPTZ  NOT NULL,
    locked_by  VARCHAR(255) NOT NULL
);

COMMENT ON TABLE shedlock IS 'ShedLock 分布式定时任务锁表（当前使用者：mis-kb kb-engine-reconcile）';

-- ---------------------------------------------------------------------------
-- D.1 菜单按钮节点（type=3）
--     91056 挂「知识库」页面 91033；91057 挂「引擎配置」页面 91038。
--     两行 permission 全仓唯一（已 grep 核实），不与任何既有行冲突。
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (91056, 1, 91010, 91033, 'kb_library_engine_ref', '查看引擎引用', 3, NULL::VARCHAR, NULL::VARCHAR, 'kb:library:engine-ref:view', NULL::VARCHAR, 4, 1, 1, NOW(), NOW()),
    (91057, 1, 91010, 91038, 'kb_engine_reconcile',   '引擎对账',     3, NULL::VARCHAR, NULL::VARCHAR, 'kb:engine:reconcile',        NULL::VARCHAR, 1, 1, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu WHERE app_id = v.app_id AND code = v.code)
  AND NOT EXISTS (SELECT 1 FROM sys_menu WHERE app_id = v.app_id AND permission = v.permission AND status = 1);

-- ---------------------------------------------------------------------------
-- D.2 授权给内置租户管理员 role_id=1（口径与 V14/V17/V25 完全一致，id = menu id）
-- ---------------------------------------------------------------------------
INSERT INTO sys_role_permission (id, role_id, perm_type, target_id, created_at)
SELECT m.id, 1, 'menu'::sys_perm_type, m.id, NOW()
FROM sys_menu m
WHERE m.id IN (91056, 91057)
  AND m.status = 1
  AND NOT EXISTS (
    SELECT 1 FROM sys_role_permission rp
    WHERE rp.role_id = 1 AND rp.perm_type = 'menu' AND rp.target_id = m.id
  )
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- D.3 sys_api 接口行（挂 V17 建的 catalog 91060「知识库工具」）
--     uk_api_method_path 是 (http_method, path_pattern) WHERE type='api' AND status=1
--     的部分唯一索引，故额外用 method+path 去重。
-- ---------------------------------------------------------------------------
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (91079, 91020, 91060, '00900013', 'api'::sys_api_node_type, '查看知识库引擎引用', 'GET',  '/api/v1/kb/libraries/{id}/engine-ref', 94, 1, NOW(), NOW()),
    (91089, 91020, 91060, '00900014', 'api'::sys_api_node_type, '查看引擎对账报告',   'GET',  '/api/v1/kb/engine/reconcile',          95, 1, NOW(), NOW()),
    (91090, 91020, 91060, '00900015', 'api'::sys_api_node_type, '手动触发引擎对账',   'POST', '/api/v1/kb/engine/reconcile',          96, 1, NOW(), NOW())
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
-- D.4 sys_menu_api 关联：接口 → 承载权限码的按钮节点
--     91079 → 91056（kb:library:engine-ref:view）
--     91089 / 91090 → 91057（kb:engine:reconcile）
--     uk_menu_api_pair(menu_id, api_id) 守卫；V8 已 DROP uk_menu_api_api(api_id)。
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (91091, 91056, 91079, 1, NOW()),
    (91092, 91057, 91089, 1, NOW()),
    (91093, 91057, 91090, 2, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE menu_id = v.menu_id AND api_id = v.api_id)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = v.menu_id)
  AND EXISTS (SELECT 1 FROM sys_api  WHERE id = v.api_id);

-- ---------------------------------------------------------------------------
-- 迁移后自检（在你方环境执行 flyway migrate 后手工跑一遍）
--
--   -- 1) A 段三列存在
--   SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_name = 'kb_library'
--     AND column_name IN ('engine_sync_status','engine_checked_at','archived_at');
--   -- 期望：3 行；engine_sync_status = smallint / NO / 0
--
--   -- 2) B/C 两张表存在
--   SELECT table_name FROM information_schema.tables
--   WHERE table_name IN ('kb_engine_orphan','shedlock');
--   -- 期望：2 行
--
--   -- 3) 权限码每个恰好 1 行（多于 1 行即违反 uk_menu_app_permission）
--   SELECT id, name, type, permission FROM sys_menu
--   WHERE app_id = 91010
--     AND permission IN ('kb:library:engine-ref:view','kb:engine:reconcile')
--     AND status = 1
--   ORDER BY id;
--   -- 期望：91056 | 查看引擎引用 | 3 | kb:library:engine-ref:view
--   --       91057 | 引擎对账     | 3 | kb:engine:reconcile
--
--   -- 4) 三条新接口在注册表联表查询里可见且 permission 正确
--   SELECT a.id, a.http_method, a.path_pattern, m.permission
--   FROM sys_api a
--   JOIN sys_menu_api ma ON ma.api_id = a.id
--   JOIN sys_menu m      ON ma.menu_id = m.id
--   JOIN sys_module sm   ON sm.id = a.module_id
--   WHERE a.id IN (91079, 91089, 91090)
--   ORDER BY a.id;
--   -- 期望：
--   --   91079 GET  /api/v1/kb/libraries/{id}/engine-ref | kb:library:engine-ref:view
--   --   91089 GET  /api/v1/kb/engine/reconcile          | kb:engine:reconcile
--   --   91090 POST /api/v1/kb/engine/reconcile          | kb:engine:reconcile
--
--   -- 5) 授权存在
--   SELECT * FROM sys_role_permission WHERE role_id = 1 AND target_id IN (91056, 91057);
--
--   -- 6) 行为验收：无 kb:engine:reconcile 的登录用户 POST /api/v1/kb/engine/reconcile
--   --    期望 HTTP 403（BFF 需重启或等注册表 refresh-interval-seconds=300s 到期重载）。
-- ---------------------------------------------------------------------------
