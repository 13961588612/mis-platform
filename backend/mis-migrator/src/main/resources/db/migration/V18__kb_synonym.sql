-- ===========================================================================
-- V18__kb_synonym.sql —— 知识库二期 Wave D：同义词与术语扩展
--
-- 设计依据：docs/backend/mis-kb-wave-d-design-2026-08-04.md §5.2-T01 / §7.2
-- 需求：WD-01（术语组唯一性）、WD-03（服务端分页）、WD-07（全局开关 + 版本号）、WD-12（操作日志）
--
-- 内容：
--   A. 词表 DDL 4 张表
--      A.1 kb_synonym_group        术语组
--      A.2 kb_synonym_term         词条（规范词 + 别名），UNIQUE(term_norm) 全局唯一
--      A.3 kb_synonym_config       单行配置表（id 固定 1），承载 enabled + dict_version
--      A.4 kb_synonym_import_batch 两段式导入的预检计划（必须落库，不能放内存）
--   B. sys_menu 3 行（1 页面 + 2 按钮）+ 排序调整
--   C. sys_role_permission 3 行（授权内置租户管理员 role_id=1）
--   D. sys_api 11 行 + sys_menu_api 11 行（让 ApiPermissionInterceptor 真正拦得住）
--
-- 幂等：固定 ID + IF NOT EXISTS + WHERE NOT EXISTS + ON CONFLICT DO NOTHING，可重复执行。
--
-- ===========================================================================
-- 【版本号说明】
--   docs/backend/knowledge-base-phase2-plan.md §11.2「KB 全量 API 未登记 sys_api」原文写的
--   是「出 V18」，该技术债的迁移版本号已顺延为 V19（该文档已同步修订）。V18 归 Wave D。
--
-- 【schema 版本注意 —— 抄错列清单会直接报错】
--   V8__module_api_refactor.sql 已 DROP 掉 sys_api 的 tenant_id 与 app_id 列，
--   唯一约束从 uk_api_app_code(app_id, code) 改为 uk_api_module_code(module_id, code)，
--   并新增 FK fk_api_module → sys_module(id)。
--   所以 D 段的 sys_api INSERT 列清单与 V2/V6 的写法**不同**（那两个是 V8 之前的旧 schema），
--   照抄旧模板会报「column "tenant_id" of relation "sys_api" does not exist」。
--   本文件的列清单**逐字照抄 V17__kb_hittest_perms.sql**（V8 之后唯一的正确样板）。
--
-- 【四条来自 V17 实战的坑（§7.2），逐条已落实】
--   1. uk_menu_app_permission 是 (app_id, permission) WHERE status=1 AND permission IS NOT NULL
--      的**部分唯一索引**（V1__init_schema.sql:269）。本文件的 3 个权限码落在
--      **3 行不同 permission** 的菜单上（91052/91053/91054），绝无两行共用同一 permission。
--      V17 的 r1 版本就是栽在「页面 + 按钮共用同一 permission」上，整个迁移 failed。
--   2. 目录节点 permission 写 NULL 不写空串（本文件不新建目录节点，父目录复用 V13 的 91030）。
--   3. sys_menu_api 挂**页面/按钮节点**，不挂目录节点。
--   4. authOnly 陷阱：ApiPermissionRegistry.java:69-73 判定 permission 为空 ⇒ authOnly=true，
--      ApiPermissionInterceptor.java:72-73 对 authOnly **直接 return true**（登录即可调）。
--      即：忘写权限码不会报错，只会**静默放行**。本文件 D 段 11 行全部挂到带 permission 的
--      菜单节点上，文件尾自检 SQL 逐行核对。
--
-- 【path_pattern 为什么带正则约束 {id:[0-9]+}】
--   ApiPermissionRegistry.match()（第 50-84 行）会遍历**全部**规则并对命中者取权限**并集**，
--   拦截器（第 82-86 行）是 any-of 语义：命中任意一个权限即放行。
--   若详情接口写成 `/api/v1/kb/synonyms/*`，它会同时匹配 `/synonyms/export`，
--   于是 GET export 的规则集合变成 {view, import}，只有 view 权限的账号也能导出全表 —— 越权。
--   AntPathMatcher 支持 `{name:regex}` 形式的 URI 模板变量，用 `{id:[0-9]+}` 把详情接口
--   限定为纯数字段位（id 由 IdGenerator 生成，恒为数字），即可与 config / export 完全隔离。
--   下方 D.2 每条规则的「独占性」在文件尾自检 SQL 的第 4 条里可验证。
--
-- 【ID / code 段位选取依据】
--   * sys_menu：Wave D 取 91052–91054（1 页面 + 2 按钮）。KB 现用段为 91001–91051
--     （91040–91051 是 V14 的按钮节点），91052–91054 全仓无占用。
--     Wave B / Wave C 尚未启动，V18 先落库，不存在抢号。
--   * sys_api / sys_menu_api：取 91062–91072（11 个）。V17 已用 91060（catalog）/ 91061（api）。
--   * sys_api.code：复用 V17 建的 0090 catalog，其下取 00900002–00900012。
--     0001–0089 段继续留给将来 KB 全模块补登记（见 plan §11.2 → V19）。
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- A.1 kb_synonym_group —— 术语组
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kb_synonym_group (
    id             BIGINT       PRIMARY KEY,
    canonical_term VARCHAR(128) NOT NULL,
    status         SMALLINT     NOT NULL DEFAULT 1,
    remark         VARCHAR(512) NULL,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_by     BIGINT       NULL
);

COMMENT ON TABLE  kb_synonym_group                IS '同义词术语组（Wave D）';
COMMENT ON COLUMN kb_synonym_group.canonical_term IS '规范词。**不独立唯一** —— 唯一性统一由 kb_synonym_term.term_norm 承担';
COMMENT ON COLUMN kb_synonym_group.status         IS '1=启用 0=停用。停用只影响是否参与扩展，**不释放词条唯一性**（Q3）';
COMMENT ON COLUMN kb_synonym_group.remark         IS '备注（可空）';
COMMENT ON COLUMN kb_synonym_group.updated_by     IS '最后修改人 userId';

CREATE INDEX IF NOT EXISTS idx_synonym_group_status  ON kb_synonym_group (status);
CREATE INDEX IF NOT EXISTS idx_synonym_group_updated ON kb_synonym_group (updated_at DESC);


-- ---------------------------------------------------------------------------
-- A.2 kb_synonym_term —— 词条（规范词 + 别名）
--
-- ⛔ uk_synonym_term_norm 是**普通 UNIQUE，不带 WHERE status = 1**（Q3 裁决）。
--    产品理由：避免「停用 A 组 → 词被 B 组抢走 → A 组无法启用」的死结。
--    工程加成：普通 UNIQUE 比部分唯一索引更难被误绕过，应用层也不必再写一遍
--    「停用的算不算冲突」的判断。
--    写成 `UNIQUE (term_norm) WHERE status = 1` 即为实现错误，勿"优化"。
--
-- ⛔ FK 走 ON DELETE CASCADE（Q4 硬删）：删组即删词，唯一性立刻释放。
--    误删恢复靠 BFF 的 @OperLog(recordParams=true) 落的"删除前快照"（§7.7）。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kb_synonym_term (
    id         BIGINT       PRIMARY KEY,
    group_id   BIGINT       NOT NULL,
    term       VARCHAR(128) NOT NULL,
    term_norm  VARCHAR(128) NOT NULL,
    canonical  SMALLINT     NOT NULL DEFAULT 0,
    sort_no    INT          NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_synonym_term_norm UNIQUE (term_norm),
    CONSTRAINT fk_synonym_term_group FOREIGN KEY (group_id)
        REFERENCES kb_synonym_group (id) ON DELETE CASCADE
);

COMMENT ON TABLE  kb_synonym_term            IS '同义词词条：规范词与别名同表（Wave D）';
COMMENT ON COLUMN kb_synonym_term.term       IS '录入原文，保留大小写用于展示';
COMMENT ON COLUMN kb_synonym_term.term_norm  IS '归一化词形（trim → NFKC → toLowerCase(Locale.ROOT)），全局唯一，停用仍占用（Q3）';
COMMENT ON COLUMN kb_synonym_term.canonical  IS '1=该行即本组规范词（随组自动维护），0=别名';
COMMENT ON COLUMN kb_synonym_term.sort_no    IS '组内优先级：规范词恒为 0，别名从 1 递增；决定预算截断时的入选顺序';

CREATE INDEX IF NOT EXISTS idx_synonym_term_group ON kb_synonym_term (group_id);


-- ---------------------------------------------------------------------------
-- A.3 kb_synonym_config —— **单行**配置表（id 固定 1）
--
-- dict_version 是跨实例词典一致性的**唯一权威源**（设计 §4.2）：
--   任何词表写操作都要 UPDATE ... SET dict_version = dict_version + 1 WHERE id = 1，
--   其它实例每 3 秒轮询这一行的主键查，版本变了才做全量重载。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kb_synonym_config (
    id           BIGINT      PRIMARY KEY,
    enabled      SMALLINT    NOT NULL DEFAULT 1,
    dict_version BIGINT      NOT NULL DEFAULT 1,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by   BIGINT      NULL,
    CONSTRAINT chk_synonym_config_singleton CHECK (id = 1)
);

COMMENT ON TABLE  kb_synonym_config              IS '同义词全局配置，**单行表**（id 恒为 1）';
COMMENT ON COLUMN kb_synonym_config.enabled      IS '业务开关（S-07 页面可写）。与 Nacos 的 mis.kb.synonym.enabled 熔断闸是双闸关系：任一为 false 即不扩展（Q2）';
COMMENT ON COLUMN kb_synonym_config.dict_version IS '词表版本号，任何写操作 +1。跨实例词典一致性的唯一权威源';

-- 幂等种子：单行 (id=1, enabled=1, dict_version=1)
INSERT INTO kb_synonym_config (id, enabled, dict_version, updated_at, updated_by)
SELECT 1, 1, 1, NOW(), NULL
WHERE NOT EXISTS (SELECT 1 FROM kb_synonym_config WHERE id = 1);


-- ---------------------------------------------------------------------------
-- A.4 kb_synonym_import_batch —— 两段式导入的预检计划
--
-- **预检计划必须落库**：预检可能落在实例 A、提交落在实例 B，内存 Map 在多实例下
-- 会「找不到 token」（与 dict_version 同一个根因，同一个解法：状态放 DB 不放内存）。
--
-- plan_json 用 TEXT 不用 VARCHAR(n)：行级计划全文可能到几百 KB。
-- dict_version 是提交期版本校验凭据（Q10 硬约束）：提交时若库内版本已变，
-- 抛 KB_SYNONYM_IMPORT_STALE「词表已变更，请重新预检」，而不是静默多跳几行。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kb_synonym_import_batch (
    id              BIGINT       PRIMARY KEY,
    token           VARCHAR(64)  NOT NULL,
    status          VARCHAR(16)  NOT NULL DEFAULT 'PENDING',
    dict_version    BIGINT       NOT NULL,
    file_name       VARCHAR(255) NULL,
    format          VARCHAR(16)  NOT NULL,
    plan_json       TEXT         NOT NULL,
    planned_create  INT          NOT NULL DEFAULT 0,
    planned_merge   INT          NOT NULL DEFAULT 0,
    planned_skip    INT          NOT NULL DEFAULT 0,
    created_by      BIGINT       NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ  NOT NULL,
    committed_at    TIMESTAMPTZ  NULL,
    CONSTRAINT uk_synonym_import_token UNIQUE (token),
    CONSTRAINT chk_synonym_import_status CHECK (status IN ('PENDING', 'COMMITTED', 'EXPIRED')),
    CONSTRAINT chk_synonym_import_format CHECK (format IN ('CSV', 'JSON'))
);

COMMENT ON TABLE  kb_synonym_import_batch              IS '同义词批量导入的预检批次（两段式导入的中间态，Wave D）';
COMMENT ON COLUMN kb_synonym_import_batch.token        IS '预检令牌，提交时凭此定位批次';
COMMENT ON COLUMN kb_synonym_import_batch.dict_version IS '预检时的词表版本号；提交时若不等于库内当前值即拒绝（Q10）';
COMMENT ON COLUMN kb_synonym_import_batch.plan_json    IS '行级计划全文（含 skip_reason）。提交执行 / 下载未导入行 / 回执计数三处共用这一份';
COMMENT ON COLUMN kb_synonym_import_batch.expires_at   IS '令牌过期时刻（默认预检后 10 分钟）。过期清理任务留待后续版本补';

CREATE INDEX IF NOT EXISTS idx_synonym_import_expires ON kb_synonym_import_batch (expires_at);


-- ---------------------------------------------------------------------------
-- B. sys_menu：1 个页面节点 + 2 个按钮节点
--
-- ⛔ 三行的 permission **互不相同**，这是 uk_menu_app_permission 的硬要求。
--    页面节点承载 view；两个按钮节点分别承载 write / import。
-- ⛔ 按钮节点的 permission **不许置 NULL**（authOnly 陷阱，见文件头坑 4）。
--
-- 页面节点的 path / component / icon / sort 必须与前端三处逐字一致（§7.9）：
--   ① frontend/mis-admin-web/src/lib/nav/kb-nav.ts   → '/kb/synonyms' / '同义词' / 'Languages'
--   ② frontend/mis-admin-web/src/components/layout/keep-alive-outlet.tsx → PAGE_MAP['/kb/synonyms']
--   ③ 本文件
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    -- 页面节点：承载 view 权限码
    (91052, 1, 91010, 91030, 'kb-synonyms',        '同义词',       2, '/kb/synonyms', 'kb/synonym/index', 'kb:config:synonym:view',   'Languages', 9, 1, 1, NOW(), NOW()),
    -- 按钮节点：新增 / 编辑 / 删除 / 全局开关
    (91053, 1, 91010, 91052, 'kb_synonym_write',   '维护同义词',   3, NULL,           NULL,               'kb:config:synonym:write',  NULL,        1, 1, 1, NOW(), NOW()),
    -- 按钮节点：批量导入 / 导出
    (91054, 1, 91010, 91052, 'kb_synonym_import',  '导入导出同义词', 3, NULL,         NULL,               'kb:config:synonym:import', NULL,        2, 1, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = v.id);

-- 把「引擎配置」后移一位，让「同义词」稳定落在「问答运营」与「引擎配置」之间。
-- 仅在该行仍为 V17 调整后的 sort 值（9）时才动，避免覆盖运营手工排序。
-- 期望最终次序：91036=6(智能问答) 91039=7(命中测试) 91037=8(问答运营) 91052=9(同义词) 91038=10(引擎配置)
UPDATE sys_menu SET sort = 10, updated_at = NOW() WHERE id = 91038 AND sort = 9;


-- ---------------------------------------------------------------------------
-- C. 授权给内置租户管理员 role_id=1（口径与 V14 / V17 完全一致）
--
-- 与 V17 同样的保留问题：sys_role 种子中尚无「知识管理员」「运营」的稳定 role_id，
-- 凭空写死 id 会造成错授/漏授。故此处仍仅授权 role_id=1，待角色体系落定后另出迁移补授。
-- ---------------------------------------------------------------------------
INSERT INTO sys_role_permission (id, role_id, perm_type, target_id, created_at)
SELECT m.id, 1, 'menu'::sys_perm_type, m.id, NOW()
FROM sys_menu m
WHERE m.id IN (91052, 91053, 91054)
  AND m.status = 1
  AND NOT EXISTS (
    SELECT 1 FROM sys_role_permission rp
    WHERE rp.role_id = 1 AND rp.perm_type = 'menu' AND rp.target_id = m.id
  )
ON CONFLICT (id) DO NOTHING;


-- ---------------------------------------------------------------------------
-- D. API 级登记：11 个 BFF 端点进入 ApiPermissionRegistry
--
-- 注册表查询（SysApiRepository.findRegistryRows）要求同时满足：
--   a.type = 'api' AND a.status = 1 AND a.http_method IS NOT NULL
--   AND a.path_pattern IS NOT NULL AND m.status = 1
--   且 a.module_id 必须能 JOIN 上 sys_module（V8 加了 FK）。KB 模块 sys_module.id = 91020。
--
-- 路径写的是 **BFF 侧** 的 /api/v1/kb/synonyms/**：ApiPermissionInterceptor 装在 BFF 上，
-- mis-kb 的 /internal/** 端点不经过它（权限由 BFF 兜住，§5.2-T09 风险提示）。
-- ---------------------------------------------------------------------------

-- D.1 catalog 父节点：复用 V17 建的 91060「知识库工具」（code 0090）。
--     不另建目录，理由：sys_api 只需要一个父目录来组织树形结构，
--     再建一个「知识库配置」目录会额外占一个 code 段位，收益为零。
--     若 V17 尚未落库（理论不可能，Flyway 按版本号顺序执行），下方 EXISTS 守卫会跳过全部 D 段。

-- D.2 接口行 11 条
--     uk_api_method_path 是 (http_method, path_pattern) WHERE type='api' AND status=1 的
--     部分唯一索引，故除固定 id 外再按 (method, path) 去重。
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (91062, 91020, 91060, '00900002', 'api'::sys_api_node_type, '同义词-术语组分页查询', 'GET',    '/api/v1/kb/synonyms',                                 11, 1, NOW(), NOW()),
    (91063, 91020, 91060, '00900003', 'api'::sys_api_node_type, '同义词-术语组详情',     'GET',    '/api/v1/kb/synonyms/{id:[0-9]+}',                     12, 1, NOW(), NOW()),
    (91064, 91020, 91060, '00900004', 'api'::sys_api_node_type, '同义词-新增术语组',     'POST',   '/api/v1/kb/synonyms',                                 13, 1, NOW(), NOW()),
    (91065, 91020, 91060, '00900005', 'api'::sys_api_node_type, '同义词-编辑术语组',     'PUT',    '/api/v1/kb/synonyms/{id:[0-9]+}',                     14, 1, NOW(), NOW()),
    (91066, 91020, 91060, '00900006', 'api'::sys_api_node_type, '同义词-删除术语组',     'DELETE', '/api/v1/kb/synonyms/{id:[0-9]+}',                     15, 1, NOW(), NOW()),
    (91067, 91020, 91060, '00900007', 'api'::sys_api_node_type, '同义词-读取全局配置',   'GET',    '/api/v1/kb/synonyms/config',                          16, 1, NOW(), NOW()),
    (91068, 91020, 91060, '00900008', 'api'::sys_api_node_type, '同义词-切换全局开关',   'PUT',    '/api/v1/kb/synonyms/config',                          17, 1, NOW(), NOW()),
    (91069, 91020, 91060, '00900009', 'api'::sys_api_node_type, '同义词-导出词表',       'GET',    '/api/v1/kb/synonyms/export',                          18, 1, NOW(), NOW()),
    (91070, 91020, 91060, '00900010', 'api'::sys_api_node_type, '同义词-导入预检',       'POST',   '/api/v1/kb/synonyms/import/precheck',                 19, 1, NOW(), NOW()),
    (91071, 91020, 91060, '00900011', 'api'::sys_api_node_type, '同义词-导入提交',       'POST',   '/api/v1/kb/synonyms/import/commit',                   20, 1, NOW(), NOW()),
    (91072, 91020, 91060, '00900012', 'api'::sys_api_node_type, '同义词-下载未导入行',   'GET',    '/api/v1/kb/synonyms/import/{batchId:[0-9]+}/rejected', 21, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api a WHERE a.id = v.id)
  AND NOT EXISTS (
    SELECT 1 FROM sys_api a
    WHERE a.type = 'api' AND a.status = 1
      AND a.http_method = v.http_method AND a.path_pattern = v.path_pattern
  )
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 91060)
  AND EXISTS (SELECT 1 FROM sys_module WHERE id = 91020);

-- D.3 菜单 → 接口 关联：permission 由被挂载的菜单节点提供。
--     读接口挂页面节点 91052（view）；写接口挂按钮节点 91053（write）；
--     导入导出接口挂按钮节点 91054（import）。
--     findRegistryRows 的 JOIN sys_menu 不过滤 type，按钮节点同样能提供 permission。
--     V8__module_api_refactor.sql:37 已 DROP uk_menu_api_api(api_id)，仅剩 uk_menu_api_pair(menu_id, api_id)。
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (91062, 91052, 91062, 1,  NOW()),   -- GET    /synonyms                        → view
    (91063, 91052, 91063, 2,  NOW()),   -- GET    /synonyms/{id}                   → view
    (91064, 91053, 91064, 3,  NOW()),   -- POST   /synonyms                        → write
    (91065, 91053, 91065, 4,  NOW()),   -- PUT    /synonyms/{id}                   → write
    (91066, 91053, 91066, 5,  NOW()),   -- DELETE /synonyms/{id}                   → write
    (91067, 91052, 91067, 6,  NOW()),   -- GET    /synonyms/config                 → view
    (91068, 91053, 91068, 7,  NOW()),   -- PUT    /synonyms/config                 → write
    (91069, 91054, 91069, 8,  NOW()),   -- GET    /synonyms/export                 → import
    (91070, 91054, 91070, 9,  NOW()),   -- POST   /synonyms/import/precheck        → import
    (91071, 91054, 91071, 10, NOW()),   -- POST   /synonyms/import/commit          → import
    (91072, 91054, 91072, 11, NOW())    -- GET    /synonyms/import/{id}/rejected   → import
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api ma WHERE ma.id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu_api ma WHERE ma.menu_id = v.menu_id AND ma.api_id = v.api_id)
  AND EXISTS (SELECT 1 FROM sys_menu  m WHERE m.id = v.menu_id)
  AND EXISTS (SELECT 1 FROM sys_api   a WHERE a.id = v.api_id);


-- ---------------------------------------------------------------------------
-- 迁移后自检（在你方环境执行 flyway migrate 后手工跑一遍，五条全绿才算通过）
--
--   -- 1) 权限码三行、互不相同（uk_menu_app_permission 回归项）
--   SELECT id, name, type, permission FROM sys_menu
--   WHERE app_id = 91010 AND permission LIKE 'kb:config:synonym%' AND status = 1
--   ORDER BY id;
--   -- 期望：恰好 3 行
--   --   91052 | 同义词         | 2 | kb:config:synonym:view
--   --   91053 | 维护同义词      | 3 | kb:config:synonym:write
--   --   91054 | 导入导出同义词  | 3 | kb:config:synonym:import
--
--   -- 2) 菜单排序
--   SELECT id, name, sort FROM sys_menu WHERE id IN (91036,91039,91037,91052,91038) ORDER BY sort;
--   -- 期望：91036=6, 91039=7, 91037=8, 91052=9, 91038=10
--
--   -- 3) 注册表自检：11 行 synonym 规则，permission 一列**无 NULL、无空串**
--   --    （任何一行为空即命中 authOnly 陷阱 → 该端点登录即可调，D 段白做）
--   SELECT a.http_method, a.path_pattern, m.permission, sm.status AS module_status
--   FROM sys_api a
--   JOIN sys_menu_api ma ON ma.api_id = a.id
--   JOIN sys_menu m      ON ma.menu_id = m.id
--   JOIN sys_module sm   ON sm.id = a.module_id
--   WHERE a.path_pattern LIKE '/api/v1/kb/synonyms%'
--     AND a.type = 'api' AND a.status = 1 AND m.status = 1
--   ORDER BY a.sort;
--   -- 期望：11 行，module_status 全为 1，permission 分布为 view×3 / write×4 / import×4
--
--   -- 3b) 反向断言：不应有任何一行 permission 为空
--   SELECT count(*) FROM sys_api a
--   JOIN sys_menu_api ma ON ma.api_id = a.id
--   JOIN sys_menu m      ON ma.menu_id = m.id
--   WHERE a.path_pattern LIKE '/api/v1/kb/synonyms%'
--     AND (m.permission IS NULL OR btrim(m.permission) = '');
--   -- 期望：0
--
--   -- 4) 单行配置表种子
--   SELECT id, enabled, dict_version FROM kb_synonym_config;
--   -- 期望：恰好 1 行 → 1 | 1 | 1
--
--   -- 5) 唯一约束形态（必须是普通 UNIQUE，**不带 WHERE**）
--   SELECT indexdef FROM pg_indexes WHERE tablename = 'kb_synonym_term';
--   -- 期望：uk_synonym_term_norm 的 indexdef 中**不含** ' WHERE '
--
--   -- 6) 行为验收：无 kb:config:synonym:write 的登录用户 POST /api/v1/kb/synonyms
--   --    期望 HTTP 403（ApiPermissionInterceptor 抛 FORBIDDEN），而不是 200。
--   --    BFF 需重启或等 refresh-interval-seconds(300s) 到期重载注册表。
--   --    同时：只有 view 权限的用户 GET /api/v1/kb/synonyms/export 也必须 403
--   --    （这是 path_pattern 用 {id:[0-9]+} 而不是 * 的直接原因，见文件头说明）。
-- ---------------------------------------------------------------------------
