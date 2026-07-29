-- MIS Platform — 员工多部门 + 用户多组织/多部门
-- PostgreSQL 16 | 库名: mis_platform
-- 对齐前端：员工任职多部门多岗位、用户权限 Sheet 组织/部门多选

-- ---------------------------------------------------------------------------
-- 员工 ↔ 部门 多对多（支持兼任；is_primary=1 即主部门，与 sys_employee.dept_id 一致）
-- ---------------------------------------------------------------------------
CREATE TABLE sys_employee_dept (
    id          BIGINT PRIMARY KEY,
    tenant_id   BIGINT   NOT NULL,
    employee_id BIGINT   NOT NULL,
    dept_id     BIGINT   NOT NULL,
    is_primary  SMALLINT NOT NULL DEFAULT 0,
    start_date  DATE     NULL,
    end_date    DATE     NULL,
    status      SMALLINT NOT NULL DEFAULT 1,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uk_emp_dept ON sys_employee_dept (employee_id, dept_id) WHERE status = 1;
CREATE INDEX idx_emp_dept_employee ON sys_employee_dept (employee_id);
CREATE INDEX idx_emp_dept_dept ON sys_employee_dept (dept_id);

-- ---------------------------------------------------------------------------
-- 用户 ↔ 组织 多对多（is_primary=1 即主组织）
-- ---------------------------------------------------------------------------
CREATE TABLE sys_user_org (
    id          BIGINT PRIMARY KEY,
    tenant_id   BIGINT   NOT NULL,
    user_id     BIGINT   NOT NULL,
    org_id      BIGINT   NOT NULL,
    is_primary  SMALLINT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uk_user_org ON sys_user_org (user_id, org_id);
CREATE INDEX idx_user_org_org ON sys_user_org (org_id);

-- ---------------------------------------------------------------------------
-- 用户 ↔ 部门 多对多（is_primary=1 即主部门，与 sys_user 未来扩展的 dept_id 一致）
-- ---------------------------------------------------------------------------
CREATE TABLE sys_user_dept (
    id          BIGINT PRIMARY KEY,
    tenant_id   BIGINT   NOT NULL,
    user_id     BIGINT   NOT NULL,
    dept_id     BIGINT   NOT NULL,
    is_primary  SMALLINT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uk_user_dept ON sys_user_dept (user_id, dept_id);
CREATE INDEX idx_user_dept_dept ON sys_user_dept (dept_id);
