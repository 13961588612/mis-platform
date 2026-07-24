-- 阶段2：注册 AI 能力（BFF → ai-platform）权限（设计 §2.4）。
-- 仅追加；不改已发布 V1–V5。
--
-- 鉴权机制说明（见 mis-system ApiService.registry）：
--   * 接口权限码取自 sys_menu.permission，经 sys_menu_api 与 sys_api 关联；
--   * sys_menu.permission 为空 → 拦截器判定为 authOnly（仅登录即可，无需权限码）。
-- 因此：4 个写类端点登记 ai:*:use 权限码；2 个探测端点 permission 留空 → authOnly。

-- 1) AI 能力模块
INSERT INTO sys_module (id, code, name, service_name, sort, status, created_at, updated_at) VALUES
(6, 'ai', 'AI 能力模块', 'mis-admin-bff', 6, 1, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- 2) sys_api：6 个能力端点（module_id = 6）
INSERT INTO sys_api (id, tenant_id, app_id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at) VALUES
(6000, 1, 1, 6, 0,    '00060000', 'catalog', 'AI 能力',       NULL, NULL,                       0, 1, NOW(), NOW()),
(6010, 1, 1, 6, 6000, '00060001', 'api',     'AI 摘要',       'POST', '/api/v1/ai/summary',         1, 1, NOW(), NOW()),
(6011, 1, 1, 6, 6000, '00060002', 'api',     'AI 抽取',       'POST', '/api/v1/ai/extract',         2, 1, NOW(), NOW()),
(6012, 1, 1, 6, 6000, '00060003', 'api',     'AI 知识库问答', 'POST', '/api/v1/ai/rag',             3, 1, NOW(), NOW()),
(6013, 1, 1, 6, 6000, '00060004', 'api',     'AI 对话补全',   'POST', '/api/v1/ai/chat/completions', 4, 1, NOW(), NOW()),
(6014, 1, 1, 6, 6000, '00060005', 'api',     'AI 健康探测',   'GET',  '/api/v1/ai/health',          5, 1, NOW(), NOW()),
(6015, 1, 1, 6, 6000, '00060006', 'api',     'AI 能力清单',   'GET',  '/api/v1/ai/features',        6, 1, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- 3) sys_menu：AI 能力菜单目录 + 按钮（permission 空 → authOnly）
INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at) VALUES
(600, 1, 1, 0,    '0006',     'AI 能力',        1, 'ai',     'ai/index',     NULL,            'Sparkles', 6, 1, 1, NOW(), NOW()),
(610, 1, 1, 600,  '00060001', 'AI 摘要',        3, NULL,     NULL,           'ai:summary:use', NULL,       1, 1, 1, NOW(), NOW()),
(611, 1, 1, 600,  '00060002', 'AI 抽取',        3, NULL,     NULL,           'ai:extract:use', NULL,       2, 1, 1, NOW(), NOW()),
(612, 1, 1, 600,  '00060003', 'AI 知识库问答',  3, NULL,     NULL,           'ai:rag:use',     NULL,       3, 1, 1, NOW(), NOW()),
(613, 1, 1, 600,  '00060004', 'AI 对话补全',    3, NULL,     NULL,           'ai:chat:use',    NULL,       4, 1, 1, NOW(), NOW()),
(614, 1, 1, 600,  '00060005', 'AI 健康探测',    3, NULL,     NULL,           NULL,            NULL,       5, 1, 1, NOW(), NOW()),
(615, 1, 1, 600,  '00060006', 'AI 能力清单',    3, NULL,     NULL,           NULL,            NULL,       6, 1, 1, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- 4) sys_menu_api：菜单 → 接口 关联（api_id 唯一，见 uk_menu_api_api）
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at) VALUES
(610, 610, 6010, 1, NOW()),
(611, 611, 6011, 1, NOW()),
(612, 612, 6012, 1, NOW()),
(613, 613, 6013, 1, NOW()),
(614, 614, 6014, 1, NOW()),
(615, 615, 6015, 1, NOW())
ON CONFLICT (id) DO NOTHING;
