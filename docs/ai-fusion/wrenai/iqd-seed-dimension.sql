-- ===========================================================================
-- iqd-seed-dimension.sql —— Phase 5 行级脱敏验证「维度造数」
-- 库名: mis_platform (Java 侧 mis-iqd 模块; 非 ai_platform)
-- 前置: Flyway 已应用 V70 (sys_dept.dept_path 物化) + V71 (iqd_* 业务表/维度注册表种子)
--        + V77 (问数独立应用迁移, 若工程师已落地)。本脚本在其后追加验证用造数。
-- 幂等: 全部 ON CONFLICT DO NOTHING / DO UPDATE, 可重复执行。
--
-- 设计依据:
--   * docs/ai-fusion/wrenai/architecture.md §4.2.2 (行级维度注册表 / A11/A12/A13)
--   * agent/ai-platform/backend/src/agent/mis_iqd/scope_resolver.py
--     - dept 维度: predicate_type=PATH_PREFIX, 列 dept_id, 字典 mis_dept_scope,
--       谓词 EXISTS(mis_dept_scope rs WHERE rs.dept_id = t.dept_id
--                   AND (rs.dept_path = '/0/1/100/' OR rs.dept_path LIKE '/0/1/100/%'))
--     - store 维度: predicate_type=ENUM, 列 store_id, 字典 mis_store_scope,
--       谓词 t.store_id IN ('S001','S002',...)
--   * mis-iqd 字典表 mis_dept_scope / mis_store_scope 由 IqdScopeSyncJobService 每日
--     同步 upsert (每目标库一张); 仓库内无其 DDL, 故本脚本 CREATE TABLE IF NOT EXISTS
--     自建最小结构, 供 Phase 5 本地验证 (生产由各目标库同步作业填充)。
--
-- 造数范围:
--   1) mis_dept_scope  —— 部门子树 (PATH_PREFIX): 根 100 含子孙 1001/1002
--   2) mis_store_scope —— 门店集合 (ENUM<=500): S001..S010
--   3) iqd_mask_rule   —— 字段脱敏规则 (phone/idcard/email)
--   4) 激活脚手架      —— connection + catalog_item + scope_policy + table_acl(row_scope)
--                       (无此脚手架时 row_scope_rules 为空, 不触发任何行级注入)
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. 字典表 (仓库内无 DDL, 自建最小结构, 仅含 scope_resolver 查询用列)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mis_dept_scope (
    dept_id   VARCHAR(64)  NOT NULL,          -- = warehouse external code (mapped; NOT MIS id)
    dept_path VARCHAR(512) NOT NULL,          -- MIS materialized path, e.g. /0/1/100/ ; prefix match
    -- composite PK: same external code reachable via multiple MIS paths; one path may map many codes (1:N)
    PRIMARY KEY (dept_id, dept_path)
);
-- LIKE '/0/1/100/%' uses prefix index (plain btree can't use LIKE prefix under default collation)
CREATE INDEX IF NOT EXISTS idx_mis_dept_scope_path
    ON mis_dept_scope (dept_path text_pattern_ops);

CREATE TABLE IF NOT EXISTS mis_store_scope (
    store_id VARCHAR(64) NOT NULL,
    PRIMARY KEY (store_id)
);

-- ---------------------------------------------------------------------------
-- 1. 部门维度造数 (PATH_PREFIX): 锚点 /0/1/100/ 命中 100 + 1001 + 1002 子树
--    phase-1 验证: 用户 X-Mis-Dept-Scope=[{id:'100',path:'/0/1/100/'}] 应只见该子树;
--    无锚点/锚点不在表内 -> fail-closed 45204。
-- ---------------------------------------------------------------------------
INSERT INTO mis_dept_scope (dept_id, dept_path) VALUES
    ('100',  '/0/1/100/'),
    ('1001', '/0/1/100/1001/'),
    ('1002', '/0/1/100/1002/'),
    ('200',  '/0/1/200/'),          -- 越权部门 (不在 100 子树, 用于负向用例)
    ('2001', '/0/1/200/2001/')
  ON CONFLICT (dept_id, dept_path) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. 门店维度造数 (ENUM<=500): 一期扁平可见集合
--    phase-1 验证: 用户 X-Mis-Stores=['S001','S002','S003'] 应只见这些门店;
--    空集 -> fail-closed 45204。
-- ---------------------------------------------------------------------------
INSERT INTO mis_store_scope (store_id) VALUES
    ('S001'), ('S002'), ('S003'), ('S004'), ('S005'),
    ('S006'), ('S007'), ('S008'), ('S009'), ('S010')
ON CONFLICT (store_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. 字段脱敏规则 (iqd_mask_rule) —— 全平台 WrenAI 结果脱敏唯一规则源
--    phase-1 验证: 结果集中 phone/身份证/邮箱列被 mask (如 138****0000)。
-- ---------------------------------------------------------------------------
INSERT INTO iqd_mask_rule (id, name, match_type, pattern, rule, priority, enabled, created_at, updated_at) VALUES
    (900101, 'mask-phone',   'column_name', 'phone',        'phone',   10, 1, NOW(), NOW()),
    (900102, 'mask-idcard',  'column_name', 'id_card',      'idcard',  20, 1, NOW(), NOW()),
    (900103, 'mask-email',   'column_name', 'email',        'email',   30, 1, NOW(), NOW()),
    (900104, 'mask-mobile',  'column_name', 'mobile',       'phone',   11, 1, NOW(), NOW())
ON CONFLICT (name) DO UPDATE SET pattern=EXCLUDED.pattern, rule=EXCLUDED.rule, enabled=EXCLUDED.enabled, updated_at=NOW();

-- ---------------------------------------------------------------------------
-- 4. 激活脚手架 (让 Worker 真正走到行级注入 + 脱敏)
--    scope_resolver._load_allowed_and_row_scope:
--      governance = scope_policy(global allow) ∩ catalog_item.in_scope
--      row_scope_rules 仅来自 iqd_table_acl 中 row_scope 非空的 ask 授权行
--    无 table_acl.row_scope -> has_row_scope=False -> 不注入 (Phase 5 无法验证)
-- ---------------------------------------------------------------------------

-- 4.1 连接 (Flyway 主键, FK 来源)
INSERT INTO iqd_connection (id, name, auth_type, status, enabled, created_at, updated_at) VALUES
    (900001, 'seed-wren-local', 'none', 'active', 1, NOW(), NOW())
ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, enabled=EXCLUDED.enabled, updated_at=NOW();

-- 4.2 目录项 (in_scope=1, 使治理层放行)
INSERT INTO iqd_catalog_item
    (id, connection_id, kind, item_key, display_name, in_scope, sensitive_level, created_at, updated_at)
VALUES
    (900011, 900001, 'table', 'sales_order', '销售订单', 1, 'none', NOW(), NOW())
ON CONFLICT (connection_id, item_key) DO UPDATE SET in_scope=EXCLUDED.in_scope, display_name=EXCLUDED.display_name, updated_at=NOW();

-- 4.3 范围策略 (global allow, 进入治理可问集)
INSERT INTO iqd_scope_policy
    (id, connection_id, subject_type, subject_id, item_key, allow, effective, created_at, updated_at)
VALUES
    (900021, 900001, 'global', '*', 'sales_order', 1, 1, NOW(), NOW())
ON CONFLICT (connection_id, subject_type, subject_id, item_key) DO NOTHING;

-- 4.4 表级 ACL (action=ask + row_scope 双维度) —— 触发行级注入的核心
--     row_scope JSONB 引用维度注册表 dimension_code (dept / store, V71 已种子)
INSERT INTO iqd_table_acl
    (id, connection_id, subject_type, subject_id, item_key, action, row_scope, created_at, updated_at)
VALUES
    (900031, 900001, 'global', '*', 'sales_order', 'ask',
     '{"dimensions":[{"dimension":"dept"},{"dimension":"store"}]}'::jsonb, NOW(), NOW())
ON CONFLICT (connection_id, subject_type, subject_id, item_key, action)
    DO UPDATE SET row_scope=EXCLUDED.row_scope, updated_at=NOW();

-- ---------------------------------------------------------------------------
-- 5. (可选) 维度注册表安全网 —— V71 已种子 dept+store, 此处仅兜底确权
--    V71 已写入 id=1(dept, PATH_PREFIX) / id=2(store, ENUM); 若环境缺失则补。
-- ---------------------------------------------------------------------------
INSERT INTO iqd_row_scope_dimension
    (id, dimension_code, dimension_name, predicate_type, column_name, header_name,
     param_whitelist, dict_table, auto_mode, enabled, sort, created_at, updated_at)
VALUES
    (1, 'dept',  '部门', 'PATH_PREFIX', 'dept_id', 'X-Mis-Dept-Scope',
     '["header:X-Mis-Dept-Scope","header:X-Mis-Depts","header:X-Mis-Orgs","user.*","ctx.*"]'::jsonb,
     'mis_dept_scope', 1, 1, 1, NOW(), NOW()),
    (2, 'store', '门店', 'ENUM',         'store_id', 'X-Mis-Stores',
     '["header:X-Mis-Stores","user.store_ids","ctx.*"]'::jsonb,
     'mis_store_scope', 1, 1, 2, NOW(), NOW())
ON CONFLICT (dimension_code) DO UPDATE SET
    predicate_type=EXCLUDED.predicate_type, column_name=EXCLUDED.column_name,
    header_name=EXCLUDED.header_name, dict_table=EXCLUDED.dict_table,
    enabled=EXCLUDED.enabled, sort=EXCLUDED.sort, updated_at=NOW();

-- ===========================================================================
-- 6. 自检查询 (验证造数结果)
-- ===========================================================================
-- SELECT count(*) AS dept_rows FROM mis_dept_scope;        -- 期望 >=5
-- SELECT count(*) AS store_rows FROM mis_store_scope;      -- 期望 >=10
-- SELECT id,name,rule,enabled FROM iqd_mask_rule WHERE id>=900101 ORDER BY id;
-- SELECT id,item_key,action,row_scope FROM iqd_table_acl WHERE id=900031;
--   -- 期望 row_scope = {"dimensions":[{"dimension":"dept"},{"dimension":"store"}]}
--
-- Phase 5 验证要点 (配合 a2ui-smoke-run.ps1 + 真实问数):
--   * 正例: 带 X-Mis-Dept-Scope=[{id:'100',path:'/0/1/100/'}] 且 X-Mis-Stores=['S001']
--           -> 注入 EXISTS(mis_dept_scope...) AND store_id IN ('S001'), 返回受限数据
--   * 负例: 无上述头 -> resolve_inject_strategy 返回 FAIL_CLOSED -> 45204 拒绝 (不漏数据)
--   * 脱敏: 结果含 phone/id_card/email 列 -> 被 iqd_mask_rule 命中脱敏
-- ===========================================================================
