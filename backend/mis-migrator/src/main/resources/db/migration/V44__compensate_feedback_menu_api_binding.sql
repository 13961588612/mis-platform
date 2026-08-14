-- ===========================================================================
-- V44__compensate_feedback_menu_api_binding.sql
--   补偿迁移：修复 V43 的段序缺陷。
--
--   问题：V43 的 D 段（sys_menu_api 绑定，行 92~103）在 E 段（菜单 92046 创建，
--   行 115~123）之前执行，且 D 段守卫含
--     AND EXISTS (SELECT 1 FROM sys_menu WHERE id = v.menu_id)
--   对 Agent 绑定行（menu_id=92046）而言，执行 D 时菜单 92046 尚未创建，
--   守卫判 false → 4 行 Agent sys_menu_api 被静默跳过（幂等设计不报错，
--   故 V43 整体仍标记 Success）。KB 绑定行（menu_id=91037）因菜单已存在而正常落库。
--   现象：菜单 92046、sys_api 92169~92172 均存在，但二者在 sys_menu_api 中无绑定，
--   管理台「会话反馈」菜单显示 0 关联 API。
--
--   修复：本文件仅补 4 行 sys_menu_api 绑定（id 与 api_id 同号，对齐 V43/V20 先例）。
--   因 V43 已发布（flyway_schema_history 标记 Success），按 ADR 不允许回改 V43，
--   故用补偿迁移 V44 追加。插入幂等，可重复执行，对「已跑 V43」与「全新部署」均安全：
--     - 已跑 V43 的环境：菜单 92046 与 sys_api 92169~92172 已存在，仅缺绑定，本文件补齐。
--     - 全新部署：V43 建好菜单与 API 后，V44 补绑定。
--
--   约束：不得修改已发布的 V1-V43；仅追加。
-- ===========================================================================

INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (92169, 92046, 92169, 1, NOW()),
    (92170, 92046, 92170, 2, NOW()),
    (92171, 92046, 92171, 3, NOW()),
    (92172, 92046, 92172, 4, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE menu_id = v.menu_id AND api_id = v.api_id)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = v.menu_id)
  AND EXISTS (SELECT 1 FROM sys_api  WHERE id = v.api_id);

-- ---------------------------------------------------------------------------
-- 迁移后自检（执行 flyway migrate 后手工跑一遍）
--   SELECT id, menu_id, api_id FROM sys_menu_api
--   WHERE menu_id = 92046 ORDER BY id;
--   -- 期望：4 行（92169~92172），menu_id 均为 92046，api_id 同号
-- ---------------------------------------------------------------------------
