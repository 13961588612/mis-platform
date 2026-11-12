-- V138__biz_category_unification.sql
-- 统一「业务分类」+ app_code 显式化 + 作废 P0 绑定表 | PostgreSQL 16 | 幂等
--
-- ## 背景（对齐 docs/design/biz-category-unification-design.md）
--   用户需求：新建统一「业务分类」（仿「流程定义分类」，租户通用、与 APP 无关）；
--   流程定义 / 表单定义改引用它；消息 / 待办的业务类型也关联它；APP 归属改由
--   独立显式字段 app_code 承载（不再由业务类型推导）。
--
-- ## 本迁移做四件事
--   1) 建统一业务分类表 biz_category（镜像 wf_category，去 APP 维度）+ 种子兜底节点 991001。
--   2) wf_instance 新增 app_code 列（显式写入；NULL = 平台级）。
--   3) sys_message 新增 biz_type 列（软引用 biz_category.code）。
--   4) 存量兜底：wf_definition / form_definition 的 category_id 全部置为 991001（不迁移，丢弃旧归属）。
--   5) P0 返工：DROP TABLE sys_app_biz_binding（作废「靠业务类型找 APP」）。
--
-- ## 幂等策略（对齐 V128 / V131 / V133 / V136 / V137）
--   * 建表 / 加列 / 加索引：IF NOT EXISTS
--   * 种子：固定 id + WHERE NOT EXISTS
--   * 存量 UPDATE：重复执行天然幂等（目标值固定）
--   * DROP TABLE：IF EXISTS
--
-- ## ⚠️ 发布顺序约束（红线）
--   DROP TABLE sys_app_biz_binding（本迁移）必须与「删 SysAppBizBinding 实体 + 删其子查询」
--   同一发布批次；迁移在应用启动前由 Flyway 执行，故 DROP + 新代码同批即可，
--   否则 Hibernate ddl-auto=validate 失败。
--
-- ## ⚠️ 只追加；绝不修改 V1~V137（checksum 变更会阻塞整条迁移链）。

-- ===========================================================================
-- 1) 统一业务分类表（镜像 wf_category，去 APP 维度；节点 code = 业务类型编码）
-- ===========================================================================
CREATE TABLE IF NOT EXISTS biz_category (
    id          BIGINT       PRIMARY KEY,
    tenant_id   BIGINT       NOT NULL,
    parent_id   BIGINT       NOT NULL DEFAULT 0,   -- 0=根；自引用邻接表
    code        VARCHAR(64)  NOT NULL,             -- 业务类型编码（租户内唯一）
    name        VARCHAR(128) NOT NULL,             -- 中文名
    description TEXT         NULL,
    sort_order  INT          NOT NULL DEFAULT 0,
    config      JSONB        NOT NULL DEFAULT '{}'::jsonb,
    deleted     SMALLINT     NOT NULL DEFAULT 0,
    created_by  BIGINT       NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_biz_category_tenant_code UNIQUE (tenant_id, code)
);

-- 分类树下钻（管理界面左侧树）
CREATE INDEX IF NOT EXISTS idx_biz_category_tree
    ON biz_category (tenant_id, parent_id, sort_order) WHERE deleted = 0;

-- ===========================================================================
-- 2) 兜底「未分类」节点（固定 id 991001，tenant=1，对齐 V132 先例 990001）
--    承接历史未归类流程 / 表单定义；不迁移旧归属。
-- ===========================================================================
INSERT INTO biz_category (id, tenant_id, parent_id, code, name, description, sort_order, config, deleted, created_by, created_at, updated_at)
SELECT 991001, 1, 0, 'UNCATEGORIZED', '未分类', '系统默认：承接历史未归类流程/表单定义', 0, '{}'::jsonb, 0, 1, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM biz_category WHERE id = 991001);

-- ===========================================================================
-- 3) wf_instance.app_code（显式写入；NULL = 平台级）
-- ===========================================================================
ALTER TABLE wf_instance ADD COLUMN IF NOT EXISTS app_code VARCHAR(64) NULL;
CREATE INDEX IF NOT EXISTS idx_wf_instance_app ON wf_instance (tenant_id, app_code);

-- ===========================================================================
-- 4) sys_message.biz_type（软引用 biz_category.code）
-- ===========================================================================
ALTER TABLE sys_message ADD COLUMN IF NOT EXISTS biz_type VARCHAR(64) NULL;
CREATE INDEX IF NOT EXISTS idx_msg_biz_type ON sys_message (tenant_id, biz_type);

-- ===========================================================================
-- 5) 存量兜底：统一挂「未分类」（不迁移，丢弃旧归属）
-- ===========================================================================
UPDATE wf_definition   SET category_id = 991001;
UPDATE form_definition SET category_id = 991001;

-- ===========================================================================
-- 6) P0 返工：作废「靠业务类型找 APP」的绑定表
-- ===========================================================================
DROP TABLE IF EXISTS sys_app_biz_binding;

-- 自检（取消注释手动执行）：
-- SELECT id, tenant_id, code, name FROM biz_category WHERE id = 991001;
-- SELECT column_name FROM information_schema.columns WHERE table_name='wf_instance' AND column_name='app_code';
-- SELECT column_name FROM information_schema.columns WHERE table_name='sys_message' AND column_name='biz_type';
-- SELECT count(*) FROM wf_definition WHERE category_id <> 991001;   -- 应为 0
-- SELECT count(*) FROM form_definition WHERE category_id <> 991001; -- 应为 0
