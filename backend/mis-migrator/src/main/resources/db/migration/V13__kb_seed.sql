-- MIS Platform — 知识库（mis-kb）种子数据
-- PostgreSQL 16 | 库名: mis_platform
-- 设计：docs/backend/mis-kb-system-design.md §3.3（密级字典 + I-01 九宫格入口）
-- 约定：固定大 ID 段（91xxxx）避免与既有种子冲突；幂等（ON CONFLICT / WHERE NOT EXISTS）。

-- ---------------------------------------------------------------------------
-- 1. 密级字典类型 kb_secrecy（复用 sys_dict，不建 kb_secrecy 表）
-- ---------------------------------------------------------------------------
INSERT INTO sys_dict_type (id, tenant_id, code, name, status, created_at, updated_at)
VALUES (91001, 0, 'kb_secrecy', '知识库密级', 1, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO sys_dict_item (id, type_id, label, value, sort, status, created_at, updated_at)
VALUES
    (91002, 91001, '普通',   'public',      1, 1, NOW(), NOW()),
    (91003, 91001, '内部',   'internal',    2, 1, NOW(), NOW()),
    (91004, 91001, '秘密',   'secret',      3, 1, NOW(), NOW()),
    (91005, 91001, '机密',   'confidential',4, 1, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. I-01 九宫格入口：APP → MODULE → MENU
-- ---------------------------------------------------------------------------
-- 2.1 应用（sys_app）：知识库
INSERT INTO sys_app (id, tenant_id, code, name, icon, base_path, mfe_remote, sort, status,
                     kind, runtime, description, portal_group, created_at, updated_at)
VALUES
    (91010, 1, 'kb', '知识库', 'BookOpen', '/kb', NULL, 10, 1,
     'subsystem', 'host', '企业知识库与智能问答', 'knowledge', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- 2.2 模块（sys_module）：kb → mis-kb 微服务
INSERT INTO sys_module (id, code, name, service_name, sort, status, created_at, updated_at)
VALUES
    (91020, 'kb', '知识库', 'mis-kb', 10, 1, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- 2.3 菜单（sys_menu）：目录 + 8 个页面
-- 页面路径与前端 keep-alive-outlet PAGE_MAP 一一对应：
--   /kb/overview /kb/categories /kb/libraries /kb/documents
--   /kb/permissions /kb/qa /kb/operations /kb/engine
INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    -- 目录
    (91030, 1, 91010, 0,   'kb',        '知识库',   1, '/kb',          NULL,                 NULL,                'BookOpen', 1, 1, 1, NOW(), NOW()),
    -- 页面
    (91031, 1, 91010, 91030, 'kb-overview',     '概览',     2, '/kb/overview',     'kb/overview/index',     'kb:overview:list',     'LayoutDashboard', 1, 1, 1, NOW(), NOW()),
    (91032, 1, 91010, 91030, 'kb-categories',   '分类管理', 2, '/kb/categories',   'kb/categories/index',   'kb:category:list',     'FolderTree',     2, 1, 1, NOW(), NOW()),
    (91033, 1, 91010, 91030, 'kb-libraries',    '知识库',   2, '/kb/libraries',    'kb/libraries/index',    'kb:library:list',      'Database',       3, 1, 1, NOW(), NOW()),
    (91034, 1, 91010, 91030, 'kb-documents',    '文档',     2, '/kb/documents',    'kb/documents/index',    'kb:document:list',     'FileText',      4, 1, 1, NOW(), NOW()),
    (91035, 1, 91010, 91030, 'kb-permissions',  '权限',     2, '/kb/permissions',  'kb/permissions/index',  'kb:acl:list',          'Lock',          5, 1, 1, NOW(), NOW()),
    (91036, 1, 91010, 91030, 'kb-qa',          '智能问答', 2, '/kb/qa',           'kb/qa/index',           'kb:qa:ask',            'Sparkles',      6, 1, 1, NOW(), NOW()),
    (91037, 1, 91010, 91030, 'kb-operations',   '问答运营', 2, '/kb/operations',   'kb/operations/index',   'kb:operation:list',    'BarChart3',     7, 1, 1, NOW(), NOW()),
    (91038, 1, 91010, 91030, 'kb-engine',      '引擎配置', 2, '/kb/engine',       'kb/engine/index',       'kb:engine:view',       'Cpu',           8, 1, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = v.id);
