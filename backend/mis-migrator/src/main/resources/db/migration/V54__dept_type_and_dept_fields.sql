-- ===========================================================================
-- V54__dept_type_and_dept_fields.sql —— 部门类型 + 部门编制数 + 是否末级
-- PostgreSQL 16 | 库名: mis_platform
-- 前置：V53 为最新；本文件为 V54，Flyway 只追加不修改已发布版本。
--
-- 内容：
--   A. 新表 sys_dept_type（精确对齐 sys_post_type 实际字段：id, tenant_id,
--      code, name, sort, status, parent_id, is_leaf, created_at, updated_at；
--      UNIQUE(tenant_id, code)；不另加 ancestors/level/org_id）。
--   B. sys_dept 加列：dept_type_id（BIGINT NULL，部门类型，逻辑关联 sys_dept_type.id）
--      + establishment_count（INT NULL DEFAULT 0，部门编制数 / headcount 配额）。
--   C. 种子数据（tenant=1，固定 id，便于前端硬编码 DEFAULT_DEPT_TYPE_ID=1002）：
--      1001 'system' '系统'  parent=0 is_leaf=0（分类）
--      1002 'default' '默认' parent=1001 is_leaf=1（末级，部门默认类型）
--   D. 存量 sys_dept.dept_type_id 全量回填为 1002（默认末级类型）。
--   E.（可选）sys_api 登记 5 个 dept-types 端点（幂等守卫，对齐 V49 风格，
--      供 BffApiRegistryDiffSurveyTest 审计；若 CI 不跑该测试可忽略，不影响主流程）。
--
-- 说明：
--   - 部门类型 ≠ 部门分类（sys_dept.category_id），新建独立表，不复用。
--   - dept_type_id 与 post_type_id 同样为逻辑 BIGINT 关联（无外键），降低迁移耦合。
--   - 是否末级由后端 DeptService 按「有无子部门」计算（isLeaf），本表 is_leaf
--     仅用于部门类型自身的末级/分类语义（与岗位类型一致）。
--   - 幂等：DDL 用 IF NOT EXISTS；种子与 sys_api 用固定 id + WHERE NOT EXISTS 守卫。
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A. 新表 sys_dept_type（精确对齐 sys_post_type 实际字段）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sys_dept_type (
    id          BIGINT PRIMARY KEY,
    tenant_id   BIGINT       NOT NULL,
    code        VARCHAR(64)  NOT NULL,
    name        VARCHAR(128) NOT NULL,
    sort        INT          NOT NULL DEFAULT 0,
    status      SMALLINT     NOT NULL DEFAULT 1,
    parent_id   BIGINT       NOT NULL DEFAULT 0,
    is_leaf     SMALLINT     NOT NULL DEFAULT 1,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_dept_type_tenant_code UNIQUE (tenant_id, code)
);

-- ---------------------------------------------------------------------------
-- B. sys_dept 加列：部门类型 id + 部门编制数
-- ---------------------------------------------------------------------------
ALTER TABLE sys_dept
    ADD COLUMN IF NOT EXISTS dept_type_id BIGINT NULL;

ALTER TABLE sys_dept
    ADD COLUMN IF NOT EXISTS establishment_count INT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- C. 种子数据：系统(分类) / 默认(末级)
-- ---------------------------------------------------------------------------
INSERT INTO sys_dept_type (id, tenant_id, code, name, sort, status, parent_id, is_leaf, created_at, updated_at)
SELECT v.* FROM (VALUES
    (1001, 1, 'system', '系统', 1, 1, 0,    0, NOW(), NOW()),  -- 分类（非末级）
    (1002, 1, 'default', '默认', 1, 1, 1001, 1, NOW(), NOW())  -- 末级（部门默认类型）
) AS v(id, tenant_id, code, name, sort, status, parent_id, is_leaf, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_dept_type WHERE id = v.id);

-- ---------------------------------------------------------------------------
-- D. 存量部门全部初始化为「默认」末级类型(id=1002)
-- ---------------------------------------------------------------------------
UPDATE sys_dept SET dept_type_id = 1002 WHERE dept_type_id IS NULL;

-- ---------------------------------------------------------------------------
-- E.（可选）sys_api 登记 5 个 dept-types 端点（对齐 V49 风格，幂等守卫）
--    读端点挂 catalog 2001「部门查询」（sort 顺延 3/4）；
--    写端点挂 catalog 2004「部门写入」（sort 顺延 4/5/6）。
--    列序沿用 V49：id, module_id, parent_id, code, type, name,
--    http_method, path_pattern, sort, status, created_at, updated_at
--    （tenant_id / app_id 由表默认值填充，与 V49 一致）。
-- ---------------------------------------------------------------------------
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (9201, 2, 2001, '00900107', 'api'::sys_api_node_type, '部门类型列表', 'GET',    '/api/v1/dept-types',         3, 1, NOW(), NOW()),
    (9202, 2, 2001, '00900108', 'api'::sys_api_node_type, '部门类型树',   'GET',    '/api/v1/dept-types/tree',    4, 1, NOW(), NOW()),
    (9203, 2, 2004, '00900109', 'api'::sys_api_node_type, '新增部门类型', 'POST',   '/api/v1/dept-types',         4, 1, NOW(), NOW()),
    (9204, 2, 2004, '00900110', 'api'::sys_api_node_type, '编辑部门类型', 'PUT',    '/api/v1/dept-types/{id}',    5, 1, NOW(), NOW()),
    (9205, 2, 2004, '00900111', 'api'::sys_api_node_type, '删除部门类型', 'DELETE', '/api/v1/dept-types/{id}',    6, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api WHERE module_id = v.module_id AND code = v.code)
  AND NOT EXISTS (
    SELECT 1 FROM sys_api a
    WHERE a.type = 'api' AND a.status = 1
      AND a.http_method = v.http_method AND a.path_pattern = v.path_pattern
  )
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 2001)
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 2004);

-- ---------------------------------------------------------------------------
-- 迁移后自检（在你方环境执行 flyway migrate 后手工跑一遍）
--
--   -- 1) 两张种子类型已存在
--   SELECT id, tenant_id, code, name, parent_id, is_leaf
--   FROM sys_dept_type WHERE tenant_id = 1 ORDER BY id;
--   -- 期望：1001 system 0 0 / 1002 default 1001 1
--
--   -- 2) 存量部门已全部回填 dept_type_id=1002
--   SELECT count(*) FROM sys_dept WHERE dept_type_id IS NULL;
--   -- 期望：0
--
--   -- 3) 部门编制数列已存在且默认 0
--   SELECT column_name, data_type, column_default, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'sys_dept' AND column_name IN ('dept_type_id', 'establishment_count');
--   -- 期望：dept_type_id bigint null / establishment_count integer 0 YES
--
--   -- 4) 5 个 dept-types 端点已登记（若 CI 审计测试纳入）
--   SELECT id, http_method, path_pattern FROM sys_api
--   WHERE path_pattern LIKE '/api/v1/dept-types%' AND type = 'api' ORDER BY id;
--   -- 期望：5 行
-- ---------------------------------------------------------------------------
