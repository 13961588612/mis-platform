-- V133__form_category_split.sql
-- 表单「分类 / 表单」双表拆分：
--   1) 新建 form_category 邻接树（逐列镜像已跑通的 wf_category）
--   2) 把 form_definition 中 kind='CATEGORY' 的行迁入 form_category（保留原 id/parent_id/deleted）
--   3) form_definition 新增 category_id BIGINT NULL（软引用 form_category.id，无外键）
--   4) 回填 category_id = 原 parent_id（仅当 parent 是同租户、未软删的分类）
--   5) 物理删除 form_definition 中已迁出的分类行（只留表单）
--   6) 登记新端点 sys_api 95066-95071
--   7) 绑定 sys_menu_api 95086-95091 → 菜单 95011
-- PostgreSQL 16
--
-- ## 决策依据（对齐 docs/design/form-category-split-design.md）
--   * 分类是表单的「属性」（form_definition.category_id），不再是「父级」（parent_id）。
--   * 分类仍是一棵任意深度的邻接树（form_category.parent_id，0=根）。
--   * 决策 B：form_definition 的旧列 kind / parent_id 采用「保留列、代码停读写」的软废弃，
--     本次**绝不 DROP** —— 以保 FormDefinitionMigrationIntegrationTest（断言 parent_id + idx_form_def_tree）
--     与 WfCategoryMigrationIntegrationTest（断言 kind + chk_form_def_kind）两个迁移验收测试原样保持绿。
--   * 决策 C：不 seed「未分类」桶 —— category_id 允许 NULL，UI 显示「未分类」。
--   * 决策 D：form-definitions/tree 端点代码移除，但 sys_api 95051 行**保留（休眠）**，
--     以保 MigrationIdempotencyIntegrationTest（断言 sys_api 95050-95056 恰 7 行）。
--   * 多租户：tenant=1 之外还有 E2E_FORM（tenant_id=900002）——本脚本按行处理，天然覆盖全租户。
--
-- ## 幂等策略（对齐 V128 / V131 / V132）
--   * 建表 / 加列 / 加索引：IF NOT EXISTS
--   * 迁分类：INSERT ... ON CONFLICT DO NOTHING（防重复行）
--   * 回填 / 删除：UPDATE / DELETE 重复执行天然幂等
--   * 数据登记：固定 ID + NOT EXISTS(同 id) + NOT EXISTS(同 code) + NOT EXISTS(同 method+path)
--   * 绑定：固定 ID + NOT EXISTS(同 id) + NOT EXISTS(同 menu_id+api_id) + 外键目标前置 EXISTS
--
-- ## ID 段位（已实测为空闲段，绝不与 V1~V132 冲突）
--   sys_api       95066-95071（空闲）
--   sys_menu_api  95086-95091（空闲）
--
-- ⚠️ 绝不修改 V120~V132（checksum 变更会阻塞整条迁移链）。

-- ===========================================================================
-- 1) form_category 邻接树（逐列镜像 wf_category）
-- ===========================================================================
CREATE TABLE IF NOT EXISTS form_category (
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
    CONSTRAINT uk_form_category_tenant_code UNIQUE (tenant_id, code)
);

-- 分类树下钻（管理界面左侧树）
CREATE INDEX IF NOT EXISTS idx_form_category_tree
    ON form_category (tenant_id, parent_id, sort_order) WHERE deleted = 0;

-- ===========================================================================
-- 2) 迁移分类行：form_definition(kind='CATEGORY') → form_category
--    保留原 id / parent_id / deleted（含软删行如 tenant=1 的 BH）/ created_*。
--    ON CONFLICT DO NOTHING：幂等（重跑或 id 冲突时跳过）。
-- ===========================================================================
INSERT INTO form_category (id, tenant_id, parent_id, code, name, description, sort_order, config, deleted, created_by, created_at, updated_at)
SELECT fd.id, fd.tenant_id, fd.parent_id, fd.code, fd.name, fd.description, fd.sort_order, fd.config, fd.deleted, fd.created_by, fd.created_at, fd.updated_at
FROM form_definition fd
WHERE fd.kind = 'CATEGORY'
ON CONFLICT DO NOTHING;

-- ===========================================================================
-- 3) form_definition.category_id（软引用 form_category.id，无外键）
--    删除分类时由 FormCategoryService 计数校验引用，故不加外键。
-- ===========================================================================
ALTER TABLE form_definition ADD COLUMN IF NOT EXISTS category_id BIGINT NULL;

CREATE INDEX IF NOT EXISTS idx_form_def_category
    ON form_definition (tenant_id, category_id) WHERE deleted = 0;

-- ===========================================================================
-- 4) 回填：表单 category_id = 原 parent_id
--    仅当 parent 是「同租户、未软删的分类」时才回填；否则保持 NULL。
--    边界（parent=0 / parent 指向软删分类 / 指向另一表单 / 不存在 / 跨租户）→ category_id 保持 NULL。
-- ===========================================================================
UPDATE form_definition fd
SET category_id = fd.parent_id
WHERE fd.kind = 'FORM'
  AND fd.parent_id IS NOT NULL AND fd.parent_id <> 0
  AND EXISTS (
      SELECT 1 FROM form_category fc
      WHERE fc.id = fd.parent_id AND fc.tenant_id = fd.tenant_id AND fc.deleted = 0
  );

-- ===========================================================================
-- 5) form_definition 只留表单：物理删除已迁出的分类行
-- ===========================================================================
DELETE FROM form_definition WHERE kind = 'CATEGORY';

-- ===========================================================================
-- 6) 新端点登记 sys_api 95066-95071（module_id=95010 任务流模块；parent_id=95010 catalog 节点）
--    路径为 BFF 对外路径（deny-unmapped:true 校验的是对外路径），与 mis-taskflow 内部
--    /internal/v1/form-categories/* 一一对应。
-- ===========================================================================
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
  (95066, 95010, 95010, 'form_category_tree',   'api'::sys_api_node_type, '表单分类树',   'GET',    '/api/v1/form-categories/tree',          66, 1, NOW(), NOW()),
  (95067, 95010, 95010, 'form_category_list',   'api'::sys_api_node_type, '表单分类列表', 'GET',    '/api/v1/form-categories',               67, 1, NOW(), NOW()),
  (95068, 95010, 95010, 'form_category_create', 'api'::sys_api_node_type, '新增表单分类', 'POST',   '/api/v1/form-categories',               68, 1, NOW(), NOW()),
  (95069, 95010, 95010, 'form_category_update', 'api'::sys_api_node_type, '更新表单分类', 'PUT',    '/api/v1/form-categories/{id:[0-9]+}',   69, 1, NOW(), NOW()),
  (95070, 95010, 95010, 'form_category_delete', 'api'::sys_api_node_type, '删除表单分类', 'DELETE', '/api/v1/form-categories/{id:[0-9]+}',   70, 1, NOW(), NOW()),
  (95071, 95010, 95010, 'form_category_get',    'api'::sys_api_node_type, '表单分类详情', 'GET',    '/api/v1/form-categories/{id:[0-9]+}',   71, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api a WHERE a.module_id = 95010 AND a.code = v.code)
  AND NOT EXISTS (
    SELECT 1 FROM sys_api a
    WHERE a.type = 'api' AND a.status = 1
      AND a.http_method = v.http_method AND a.path_pattern = v.path_pattern
  );

-- ===========================================================================
-- 7) 表单分类端点 sys_menu_api 绑定（95066-95071 → 95011 表单注册）
--    菜单 95011（biz:form:list）已由 V128 授权给 role_id=1 → 无需新增 sys_role_permission。
-- ===========================================================================
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
  (95086, 95011, 95066, 1,  NOW()),
  (95087, 95011, 95067, 2,  NOW()),
  (95088, 95011, 95068, 3,  NOW()),
  (95089, 95011, 95069, 4,  NOW()),
  (95090, 95011, 95070, 5,  NOW()),
  (95091, 95011, 95071, 6,  NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu_api ma WHERE ma.menu_id = v.menu_id AND ma.api_id = v.api_id)
  AND EXISTS (SELECT 1 FROM sys_menu m WHERE m.id = v.menu_id AND m.status = 1)
  AND EXISTS (SELECT 1 FROM sys_api a WHERE a.id = v.api_id);

-- 自检（取消注释手动执行）：
-- SELECT id, tenant_id, parent_id, code, name, deleted FROM form_category ORDER BY id;
-- SELECT id, tenant_id, category_id, code, name, kind, parent_id FROM form_definition ORDER BY id;
-- SELECT count(*) FROM form_definition WHERE kind = 'CATEGORY';   -- 应为 0
-- SELECT id, http_method, path_pattern FROM sys_api WHERE id BETWEEN 95066 AND 95071 ORDER BY id;
-- SELECT ma.id, ma.menu_id, ma.api_id FROM sys_menu_api ma WHERE ma.api_id BETWEEN 95066 AND 95071 ORDER BY ma.id;
