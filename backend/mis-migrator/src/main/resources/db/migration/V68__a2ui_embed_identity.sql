-- MIS Platform — A2UI D12 嵌入身份兑换存储 + 权限码/sys_api 登记
-- PostgreSQL 16 | 库名: mis_platform
-- 依据：docs/ai-fusion/a2ui/02-task-breakdown.md §5.2（表结构）/ §2.3（文件矩阵）
--        docs/ai-fusion/a2ui/03-permission-design.md §2.4/§3.2（权限码 + sys_api）
--
-- 内容：
--   1. agent_external_host（宿主注册表，含 tenant_id 平台化扩展列）
--   2. agent_external_identity（外部用户 → MIS 用户 显式映射，phone_hash 匹配键非唯一）
--   3. sys_menu：A2UI 权限码按钮节点（approval:view / approval:decide / form:submit）
--   4. sys_api + sys_menu_api：A2UI 写操作端点（approval/decide、dynamic/submit）
--   5. sys_role_permission：授权内置租户管理员（role_id=1）
--
-- ID 段（已 grep 全仓 V1-V67 无占用）：sys_menu 92400-92403 / sys_api+sys_menu_api 92450-92452
-- 幂等：固定 ID + WHERE NOT EXISTS + (method,path) 去重；Flyway 版本化追加。
-- 约束：append-only，不得修改 V1–V67。

-- ---------------------------------------------------------------------------
-- 1. agent_external_host —— 宿主注册表（02 §5.2 + tenant_id 扩展）
--    tenant_id：手机号匹配按租户限定查询范围（mis-iam 分页端点 tenantId 必填）；
--    未配置则跳过手机号匹配直接走影子账号。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_external_host (
    host_id            VARCHAR(64) PRIMARY KEY,
    host_name          VARCHAR(128),
    client_id          VARCHAR(64)  NOT NULL,
    client_secret_hash VARCHAR(128) NOT NULL,          -- 仅存哈希（泄露面最小，R1）
    allowed_origins    JSON         NOT NULL,          -- iframe 白名单（继承 VITE_PARENT_ORIGINS 语义）
    shadow_mis_user_id VARCHAR(64),                    -- 影子账号（粗粒度默认）
    status             VARCHAR(16)  DEFAULT 'active',
    tenant_id          BIGINT,                         -- 平台化扩展：手机号匹配的租户范围
    created_at         TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- 2. agent_external_identity —— 外部用户 → MIS 用户 显式映射（02 §5.2）
--    phone_hash：匹配键（非唯一），允许一手机号多行（用户拍板：不清理历史数据，
--    歧义由兑换端 fail-closed 兜底，不要求业务侧清理）。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_external_identity (
    host_id           VARCHAR(64)  NOT NULL,
    external_user_id  VARCHAR(128) NOT NULL,
    external_username VARCHAR(128),
    mis_user_id       VARCHAR(64)  NOT NULL,
    phone_hash        VARCHAR(64),                     -- sha256(phone + salt)，匹配键（非唯一）
    phone_enc         VARCHAR(512),                    -- AES-GCM 密文（P1 可选）
    status            VARCHAR(16)  DEFAULT 'active',
    created_at        TIMESTAMP,
    PRIMARY KEY (host_id, external_user_id)
);

CREATE INDEX IF NOT EXISTS idx_external_identity_phone
    ON agent_external_identity(phone_hash)
    WHERE phone_hash IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. sys_menu —— A2UI 权限码按钮节点（type=3；不进侧栏，只承载 permission）
--    父节点：92400（隐藏页面节点，visible=0，挂 agent 根菜单 92030 之下）
--    按钮：92401 approval:view（渲染码）/ 92402 approval:decide（操作码）
--          / 92403 form:submit（操作码）
--    前置：V19（sys_app 92010 / sys_module 92020 / sys_menu 92030）
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (92400, 1, 92010, 92030, 'a2ui-catalog', 'A2UI 组件权限', 2, '/agent/a2ui', NULL, NULL, NULL, 14, 0, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = v.id)
  AND EXISTS (SELECT 1 FROM sys_app WHERE id = 92010);

INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (92401, 1, 92010, 92400, 'a2ui_approval_view',   'A2UI 审批卡片查看', 3, NULL, NULL, 'approval:view',   NULL, 1, 1, 1, NOW(), NOW()),
    (92402, 1, 92010, 92400, 'a2ui_approval_decide', 'A2UI 审批通过/驳回', 3, NULL, NULL, 'approval:decide', NULL, 2, 1, 1, NOW(), NOW()),
    (92403, 1, 92010, 92400, 'a2ui_form_submit',     'A2UI 表单提交',     3, NULL, NULL, 'form:submit',     NULL, 3, 1, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = v.id)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = 92400);

-- ---------------------------------------------------------------------------
-- 4. sys_api + sys_menu_api —— A2UI 写操作端点（deny-unmapped=true fail-closed）
--    ⚠️ exchange 端点不在此登记：它由外部系统后端直调（无 MIS JWT，externalToken
--    验签），已从 ApiPermissionInterceptor 豁免（excludePathPatterns）；
--    若登记 sys_api，外部调用会在拦截器处因缺 LoginUser 直接 401。
-- ---------------------------------------------------------------------------

-- 4.1 catalog 根节点（type='catalog'，不参与判权，仅树形父节点）
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (92450, 92020, 0, '0093', 'catalog'::sys_api_node_type, 'A2UI 写操作 API', NULL::VARCHAR, NULL::VARCHAR, 93, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api WHERE module_id = 92020 AND code = v.code)
  AND EXISTS (SELECT 1 FROM sys_module WHERE id = 92020);

-- 4.2 接口行（type='api'）；列清单无 tenant_id/app_id（V8 已 DROP）
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (92451, 92020, 92450, '00930001', 'api'::sys_api_node_type, 'A2UI 审批决策',   'POST', '/api/v1/approval/decide',      1, 1, NOW(), NOW()),
    (92452, 92020, 92450, '00930002', 'api'::sys_api_node_type, 'A2UI 表单提交',   'POST', '/api/v1/dynamic/submit',       2, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api a WHERE a.module_id = 92020 AND a.code = v.code)
  AND NOT EXISTS (
    SELECT 1 FROM sys_api a
    WHERE a.type = 'api' AND a.status = 1
      AND a.http_method = v.http_method
      AND a.path_pattern = v.path_pattern
  )
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 92450);

-- 4.3 sys_menu_api —— 接口 ⇄ 菜单 关联（permission 由菜单侧提供）
--     92451 → 92402（approval:decide）   92452 → 92403（form:submit）
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (92451, 92402, 92451, 1, NOW()),
    (92452, 92403, 92452, 1, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (
    SELECT 1 FROM sys_menu_api ma WHERE ma.menu_id = v.menu_id AND ma.api_id = v.api_id
  )
  AND EXISTS (SELECT 1 FROM sys_menu m  WHERE m.id = v.menu_id)
  AND EXISTS (SELECT 1 FROM sys_api  a  WHERE a.id = v.api_id);

-- ---------------------------------------------------------------------------
-- 5. sys_role_permission —— 授权内置租户管理员（role_id=1，与既有迁移口径一致）
--    页面 92400 + 按钮 92401-92403 全授；普通角色按需在角色模板勾选。
-- ---------------------------------------------------------------------------
INSERT INTO sys_role_permission (id, role_id, perm_type, target_id, created_at)
SELECT m.id, 1, 'menu'::sys_perm_type, m.id, NOW()
FROM sys_menu m
WHERE m.id IN (92400, 92401, 92402, 92403)
  AND m.app_id = 92010
  AND m.status = 1
  AND NOT EXISTS (
    SELECT 1 FROM sys_role_permission rp
    WHERE rp.role_id = 1 AND rp.perm_type = 'menu' AND rp.target_id = m.id
  )
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 迁移后自检
--   -- 1) 表结构
--   SELECT column_name FROM information_schema.columns WHERE table_name='agent_external_host' ORDER BY ordinal_position;
--   -- 2) 权限码登记
--   SELECT id, code, permission FROM sys_menu WHERE id IN (92400, 92401, 92402, 92403);
--   -- 3) sys_api 注册表（approval/decide、dynamic/submit 均应带非空 permission）
--   SELECT a.http_method, a.path_pattern, m.permission
--   FROM sys_api a
--   JOIN sys_menu_api ma ON ma.api_id = a.id
--   JOIN sys_menu m      ON ma.menu_id = m.id
--   WHERE a.module_id = 92020 AND a.type = 'api' AND a.sort BETWEEN 93 AND 94
--   ORDER BY a.sort;
--   -- 4) 授权行
--   SELECT COUNT(*) FROM sys_role_permission
--   WHERE role_id = 1 AND perm_type = 'menu' AND target_id IN (92400, 92401, 92402, 92403);
-- ---------------------------------------------------------------------------
