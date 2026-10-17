-- V151__message_manage.sql
-- 消息管理：圈人快照、附件元数据、菜单与 API | PostgreSQL 16 | 幂等
--
-- 后台发送走既有 sys_message（NOTIFY / ANNOUNCEMENT），audience 非空即发送记录。
-- 附件与富文本图片二进制在 MinIO 桶 mis-message；本表只存对象键。
-- ID：sys_menu 95131；sys_api 95141-95146；sys_menu_api 95141-95147；sys_role_permission 95131
--
-- ⚠️ 只追加；绝不修改已发布迁移。

ALTER TABLE sys_message
    ADD COLUMN IF NOT EXISTS audience JSONB NULL;

COMMENT ON COLUMN sys_message.audience IS '后台发送圈人快照（全员/部门/岗位类型/指定人，并集）。NULL = 非后台发送';

CREATE INDEX IF NOT EXISTS idx_msg_audience_sent
    ON sys_message (tenant_id, created_at DESC)
    WHERE deleted = 0 AND audience IS NOT NULL;

CREATE TABLE IF NOT EXISTS sys_message_file (
    id           BIGINT PRIMARY KEY,
    tenant_id    BIGINT       NOT NULL,
    object_key   VARCHAR(512) NOT NULL,
    file_name    VARCHAR(256) NOT NULL,
    mime         VARCHAR(128) NOT NULL,
    size_bytes   BIGINT       NOT NULL,
    created_by   BIGINT       NOT NULL,
    message_id   BIGINT       NULL,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_msg_file_tenant
    ON sys_message_file (tenant_id, created_by);

COMMENT ON TABLE sys_message_file IS '消息附件与正文图片元数据；对象在 MinIO mis-message';

-- 按钮权限挂在「消息与待办」(95003) 下，不单独占侧栏入口。消息中心内按 permission 显隐。
INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
  (95131, 1, 1, 95003, 'taskflow-message-manage', '消息管理', 3, NULL, NULL, 'taskflow:message:manage', NULL, 10, 0, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu WHERE app_id = 1 AND code = v.code);

INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
  (95141, 95010, 95010, 'msg_manage_preview', 'api'::sys_api_node_type, '消息接收人数预览', 'POST', '/api/v1/messages/manage/preview', 141, 1, NOW(), NOW()),
  (95142, 95010, 95010, 'msg_manage_send',    'api'::sys_api_node_type, '后台发送消息',     'POST', '/api/v1/messages/manage/send',    142, 1, NOW(), NOW()),
  (95143, 95010, 95010, 'msg_manage_sent',    'api'::sys_api_node_type, '发送记录',         'GET',  '/api/v1/messages/manage/sent',    143, 1, NOW(), NOW()),
  (95144, 95010, 95010, 'msg_manage_sent_one','api'::sys_api_node_type, '发送记录详情',     'GET',  '/api/v1/messages/manage/sent/{id:[0-9]+}', 144, 1, NOW(), NOW()),
  (95145, 95010, 95010, 'msg_manage_upload',  'api'::sys_api_node_type, '消息文件上传',     'POST', '/api/v1/messages/manage/files',   145, 1, NOW(), NOW()),
  (95146, 95010, 95010, 'msg_file_download',  'api'::sys_api_node_type, '消息文件下载',     'GET',  '/api/v1/messages/files/{id:[0-9]+}', 146, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api a WHERE a.module_id = 95010 AND a.code = v.code);

INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
  (95141, 95131, 95141, 1, NOW()),
  (95142, 95131, 95142, 2, NOW()),
  (95143, 95131, 95143, 3, NOW()),
  (95144, 95131, 95144, 4, NOW()),
  (95145, 95131, 95145, 5, NOW()),
  (95146, 95131, 95146, 6, NOW()),
  (95147, 95003, 95146, 7, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu_api ma WHERE ma.menu_id = v.menu_id AND ma.api_id = v.api_id)
  AND EXISTS (SELECT 1 FROM sys_menu m WHERE m.id = v.menu_id AND m.status = 1)
  AND EXISTS (SELECT 1 FROM sys_api a WHERE a.id = v.api_id);

INSERT INTO sys_role_permission (id, role_id, perm_type, target_id, created_at)
SELECT v.* FROM (VALUES
  (95131, 1, 'menu'::sys_perm_type, 95131, NOW())
) AS v(id, role_id, perm_type, target_id, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_role_permission WHERE id = v.id)
  AND NOT EXISTS (
    SELECT 1 FROM sys_role_permission rp
    WHERE rp.role_id = v.role_id AND rp.perm_type = v.perm_type AND rp.target_id = v.target_id
  )
  AND EXISTS (SELECT 1 FROM sys_role WHERE id = v.role_id)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = v.target_id);
