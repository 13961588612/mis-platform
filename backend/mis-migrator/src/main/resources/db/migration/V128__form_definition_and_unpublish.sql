-- V128__form_definition_and_unpublish.sql
-- 业务表单注册表（form_definition）+ 流程「取消发布」端点登记 + 补登记漏登记的 PUT 端点
-- PostgreSQL 16
--
-- 幂等策略（每段都独立可重复执行，连跑两次结果一致）：
--   * 建表/建索引：IF NOT EXISTS
--   * 数据登记：固定 ID + `WHERE NOT EXISTS (同 ID) AND NOT EXISTS (同业务键)`
--     —— 双层判定，既防重复行也防「同 code 换 ID 重复插入」
--   * 外键目标存在性：EXISTS 前置，避免依赖执行顺序
--
-- 段位（已核实 V1~V127 全部文件 + V123/V125/V126 实占）：
--   sys_menu      95001-95009 已占（V123），95010-95011 空闲
--   sys_api       95045-95047（V125）、95048（V126）已占，95049 仅被 V125 注释预订但未占用，
--                 本次从 95050 起连续取 7 行，95049 保留
--   sys_menu_api  沿用同一 95050-95056 段位（与 sys_api 一一对应，便于排查）
--
-- ⚠️ 绝不修改 V120~V127（checksum 变更会阻塞整条迁移链）。

-- ===========================================================================
-- 1) 业务表单注册表
--    一条记录 = 一个 formCode = 前端注册表里的一个组件。
--    后台管「哪个 formCode 存在、归哪一类、启用没有」；前端管「它长什么样」。
--    刻意不存 schema：不做低代码设计器。
-- ===========================================================================
CREATE TABLE IF NOT EXISTS form_definition (
    id          BIGINT PRIMARY KEY,
    tenant_id   BIGINT       NOT NULL,
    parent_id   BIGINT       NOT NULL DEFAULT 0,   -- 0=根分类；自引用邻接表
    code        VARCHAR(64)  NOT NULL,             -- = 前端注册表 key，精确匹配（大小写敏感）
    name        VARCHAR(128) NOT NULL,             -- 中文名，后台展示用
    description TEXT         NULL,
    status      VARCHAR(16)  NOT NULL DEFAULT 'ENABLED',  -- ENABLED / DISABLED
    sort_order  INT          NOT NULL DEFAULT 0,
    config      JSONB        NOT NULL DEFAULT '{}'::jsonb, -- 预留：图标/分组/排序权重
    deleted     SMALLINT     NOT NULL DEFAULT 0,
    created_by  BIGINT       NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    -- ⚠️ 唯一约束刻意**不带** `WHERE deleted = 0`（与 wf_definition 的 uk_wf_def_tenant_code_ver 不同）：
    --   wf_instance.started_form_code 是无外键的字符串软引用，历史实例里存着 'PUR_FORM'。
    --   若 code 软删后可复用，新建的同名表单会让老实例的审批页渲染出错误组件 ⇒ 数据正确性问题。
    --   代价：code 永久占用。处置见 FormDefinitionService.delete() 的引用校验。
    CONSTRAINT uk_form_def_tenant_code UNIQUE (tenant_id, code)
);

-- 分类树下钻（管理界面左侧树）
CREATE INDEX IF NOT EXISTS idx_form_def_tree ON form_definition (tenant_id, parent_id, sort_order) WHERE deleted = 0;
-- 「哪些流程用了这个表单」反查 / 编排弹窗拉可选清单
CREATE INDEX IF NOT EXISTS idx_form_def_status ON form_definition (tenant_id, status) WHERE deleted = 0;

-- ===========================================================================
-- 2) 菜单：表单管理目录 + 表单注册页（挂「系统管理」id=200 下，与「流程中心」平级）
--    目录行 permission 必须为 NULL —— uk_menu_app_permission 是
--    (app_id, permission) WHERE status=1 AND permission IS NOT NULL 的部分唯一索引，
--    目录给了 permission 就得多占一个唯一值，徒增冲突面。
-- ===========================================================================
INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
  (95010, 1, 1, 200, 'biz-form-defs', '表单管理', 1, '/system/forms',   NULL, NULL,             'FileStack', 22, 1, 1, NOW(), NOW()),
  (95011, 1, 1, 95010, 'biz-form-list', '表单注册', 2, '/system/forms', NULL, 'biz:form:list', 'ListTree',  1, 1, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu WHERE app_id = v.app_id AND code = v.code);

-- ===========================================================================
-- 3) sys_api 登记（module_id=95010 任务流模块；parent_id=95010 catalog 节点）
--
-- ⚠️ 95056 = PUT /api/v1/workflow/definitions/{id:[0-9]+} 是**补登记**：
--   端点代码在 WfDefinitionController 里早已存在（@PutMapping("/{id}")），
--   但 V123 只登记了 GET /definitions、GET /definitions/{id}、POST /definitions、POST /{id}/activate，
--   PUT 漏登记 ⇒ mis-admin-bff 的 deny-unmapped:true 会把它拦成 403。
--   「编辑已有流程定义」这条路今天就是 403。补上这一行即可打通。
-- ===========================================================================
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
  (95050, 95010, 95010, '00950050', 'api'::sys_api_node_type, '取消发布流程定义', 'POST',   '/api/v1/workflow/definitions/{id:[0-9]+}/deactivate', 50, 1, NOW(), NOW()),
  (95051, 95010, 95010, '00950051', 'api'::sys_api_node_type, '表单定义树',       'GET',    '/api/v1/form-definitions/tree',                        51, 1, NOW(), NOW()),
  (95052, 95010, 95010, '00950052', 'api'::sys_api_node_type, '表单定义列表',     'GET',    '/api/v1/form-definitions',                             52, 1, NOW(), NOW()),
  (95053, 95010, 95010, '00950053', 'api'::sys_api_node_type, '新增表单定义',     'POST',   '/api/v1/form-definitions',                             53, 1, NOW(), NOW()),
  (95054, 95010, 95010, '00950054', 'api'::sys_api_node_type, '更新表单定义',     'PUT',    '/api/v1/form-definitions/{id:[0-9]+}',                54, 1, NOW(), NOW()),
  (95055, 95010, 95010, '00950055', 'api'::sys_api_node_type, '删除表单定义',     'DELETE', '/api/v1/form-definitions/{id:[0-9]+}',                55, 1, NOW(), NOW()),
  (95056, 95010, 95010, '00950056', 'api'::sys_api_node_type, '更新流程定义',     'PUT',    '/api/v1/workflow/definitions/{id:[0-9]+}',            56, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api a WHERE a.module_id = 95010 AND a.code = v.code)
  AND NOT EXISTS (
    SELECT 1 FROM sys_api a
    WHERE a.type = 'api' AND a.status = 1
      AND a.http_method = v.http_method AND a.path_pattern = v.path_pattern
  );

-- ===========================================================================
-- 4) 菜单 ⇄ API 绑定
--    取消发布 / PUT 更新定义 → 「流程编排」95007（permission=workflow:definition:edit）
--    表单 CRUD            → 「表单注册」95011（permission=biz:form:list）
-- ===========================================================================
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
  (95050, 95007, 95050, 3, NOW()),   -- 取消发布流程定义
  (95056, 95007, 95056, 4, NOW()),   -- 更新流程定义（补登记）
  (95051, 95011, 95051, 1, NOW()),   -- 表单定义树
  (95052, 95011, 95052, 2, NOW()),   -- 表单定义列表
  (95053, 95011, 95053, 3, NOW()),   -- 新增表单定义
  (95054, 95011, 95054, 4, NOW()),   -- 更新表单定义
  (95055, 95011, 95055, 5, NOW())    -- 删除表单定义
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu_api ma WHERE ma.menu_id = v.menu_id AND ma.api_id = v.api_id)
  AND EXISTS (SELECT 1 FROM sys_menu m WHERE m.id = v.menu_id AND m.status = 1)
  AND EXISTS (SELECT 1 FROM sys_api a WHERE a.id = v.api_id);

-- ===========================================================================
-- 5) 内置租户管理员（role_id=1）菜单授权
--    ⚠️ 不触碰 V127 的 95001-95005（个人事务菜单，permission 必须保持 NULL）。
-- ===========================================================================
INSERT INTO sys_role_permission (id, role_id, perm_type, target_id, created_at)
SELECT v.* FROM (VALUES
  (95010, 1, 'menu'::sys_perm_type, 95010, NOW()),
  (95011, 1, 'menu'::sys_perm_type, 95011, NOW())
) AS v(id, role_id, perm_type, target_id, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_role_permission WHERE id = v.id)
  AND NOT EXISTS (
    SELECT 1 FROM sys_role_permission rp
    WHERE rp.role_id = v.role_id AND rp.perm_type = v.perm_type AND rp.target_id = v.target_id
  )
  AND EXISTS (SELECT 1 FROM sys_role WHERE id = v.role_id);

-- 自检（取消注释手动执行）：
-- SELECT id, code, name, status FROM form_definition;
-- SELECT id, code, name, http_method, path_pattern FROM sys_api WHERE id BETWEEN 95050 AND 95056 ORDER BY id;
-- SELECT id, code, name, type, path, permission FROM sys_menu WHERE id BETWEEN 95010 AND 95011 ORDER BY id;
-- SELECT menu_id, api_id FROM sys_menu_api WHERE id BETWEEN 95050 AND 95056 ORDER BY id;