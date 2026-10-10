-- V131__form_wf_category_schema.sql
-- 表单定义加 kind 列（CATEGORY / FORM 复用单表）+ 新建 wf_category 邻接树 + wf_definition 加 category_id
-- PostgreSQL 16
--
-- 决策 B 落地：
--   * form_definition 加 kind：CATEGORY=纯文件夹、FORM=真实表单（决策 A：code 指向前端已注册组件）
--   * wf_category：流程分类独立邻接树（与 form_definition 同形、无 kind/status）
--   * wf_definition 加 category_id：指向 wf_category.id 的软引用（无外键），旧 category VARCHAR 列保留废弃
--
-- 幂等策略（每段独立可重复执行）：
--   * 加列：ADD COLUMN IF NOT EXISTS
--   * 加索引：CREATE INDEX IF NOT EXISTS
--   * 加 CHECK：DO 块内判断约束是否存在再 ADD
--
-- ⚠️ 绝不修改 V120~V130（checksum 变更会阻塞整条迁移链）。

-- ===========================================================================
-- 1) form_definition.kind
--    NOT NULL DEFAULT 'FORM'：PostgreSQL 11+ 加带默认值的 NOT NULL 列是元数据操作，
--    现有行自动填 'FORM'，无需 UPDATE 回填（旧行语义：默认全是真实表单）。
-- ===========================================================================
ALTER TABLE form_definition ADD COLUMN IF NOT EXISTS kind VARCHAR(16) NOT NULL DEFAULT 'FORM';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.constraint_column_usage
        WHERE table_name = 'form_definition' AND constraint_name = 'chk_form_def_kind'
    ) THEN
        ALTER TABLE form_definition ADD CONSTRAINT chk_form_def_kind
            CHECK (kind IN ('CATEGORY', 'FORM'));
    END IF;
END $$;

-- ===========================================================================
-- 2) wf_category 邻接树表（与 form_definition 同形，去掉 status、无 kind）
-- ===========================================================================
CREATE TABLE IF NOT EXISTS wf_category (
    id          BIGINT       PRIMARY KEY,
    tenant_id   BIGINT       NOT NULL,
    parent_id   BIGINT       NOT NULL DEFAULT 0,   -- 0=根；自引用邻接表
    code        VARCHAR(64)  NOT NULL,             -- 分类编码（文件夹 key）
    name        VARCHAR(128) NOT NULL,             -- 中文名
    description TEXT         NULL,
    sort_order  INT          NOT NULL DEFAULT 0,
    config      JSONB        NOT NULL DEFAULT '{}'::jsonb,
    deleted     SMALLINT     NOT NULL DEFAULT 0,
    created_by  BIGINT       NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_wf_category_tenant_code UNIQUE (tenant_id, code)
);

-- 分类树下钻（管理界面左侧树）
CREATE INDEX IF NOT EXISTS idx_wf_category_tree
    ON wf_category (tenant_id, parent_id, sort_order) WHERE deleted = 0;

-- ===========================================================================
-- 3) wf_definition.category_id（软引用 wf_category.id，无外键约束）
--    删除分类时由 service 计数校验引用，故不加外键。
-- ===========================================================================
ALTER TABLE wf_definition ADD COLUMN IF NOT EXISTS category_id BIGINT NULL;

CREATE INDEX IF NOT EXISTS idx_wf_def_category
    ON wf_definition (tenant_id, category_id) WHERE deleted = 0;

-- 自检（取消注释手动执行）：
-- SELECT id, tenant_id, code, name, kind FROM form_definition LIMIT 5;
-- SELECT id, tenant_id, code, name FROM wf_category;
-- SELECT id, code, category, category_id FROM wf_definition LIMIT 5;
