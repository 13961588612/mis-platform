-- =============================================================================
-- V99__iqd_ask_bind_test_use.sql
-- 问数测试台：POST /iqd/ask|/ask-stream 额外绑定 iqd:test:use（菜单 92524）
-- 原仅绑 ai:chat:use（613）；测试台页/按钮是 iqd:test:use，缺 chat 码时会 40300。
-- 拦截器对多绑定取并集（任一权限即可），不影响已有 ai:chat:use 用户。
-- 前置：V72（ask 注册+绑 613）；V74（92524 iqd:test:use）；V98
-- =============================================================================

INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.id, v.menu_id, v.api_id, v.sort, NOW()
FROM (VALUES
    (9255401::bigint, 92524::bigint, 92554::bigint, 2),  -- ask → iqd:test:use
    (9255501::bigint, 92524::bigint, 92555::bigint, 2)   -- ask-stream → iqd:test:use
) AS v(id, menu_id, api_id, sort)
WHERE EXISTS (SELECT 1 FROM sys_menu m WHERE m.id = v.menu_id AND m.status = 1)
  AND EXISTS (SELECT 1 FROM sys_api a WHERE a.id = v.api_id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (
      SELECT 1 FROM sys_menu_api ma
      WHERE ma.menu_id = v.menu_id AND ma.api_id = v.api_id
  );
