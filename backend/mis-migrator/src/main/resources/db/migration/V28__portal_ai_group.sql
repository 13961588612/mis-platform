-- MIS Platform — 门户分组：知识库 + 智能体 → 「AI助手」
-- PostgreSQL 16 | 库名: mis_platform
--
-- 需求：门户筛选页签与顶部应用切换器新增 ai 分组（前端 lib/nav/app-groups.ts 的
-- APP_GROUP_LABEL / portal-page.tsx 的 FILTERS 已同步加 'ai'）。
-- 本迁移把 sys_app.portal_group 归组：
--   * kb    原值 'knowledge'（V13 历史遗留，不在门户筛选页签里，只能在「全部」下看到）
--   * agent 原值 'platform'（V19 沿用已知 key，协同与平台）
-- 统一改为 'ai'（AI助手），使两个 AI 子系统在门户「AI助手」页签与切换器分组下并列展示。
--
-- 幂等：UPDATE 可重复执行；tenant_id=1 为内置租户。
UPDATE sys_app
SET portal_group = 'ai'
WHERE tenant_id = 1
  AND code IN ('kb', 'agent');

-- 迁移后自检：
--   SELECT id, code, name, portal_group FROM sys_app WHERE code IN ('kb','agent');
--   期望：91010 | kb    | 知识库 | ai
--         92010 | agent | 智能体 | ai
