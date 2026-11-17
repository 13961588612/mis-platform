-- V171：下线智能体 APP 侧栏「技能权限」页（92038）
-- 授权入口已在技能池「设置权限」；保留 agent:skill:grant 与 grants API。
-- 将 92038 改为技能池下的按钮，角色授权 / sys_menu_api 无需搬家。
-- PostgreSQL 16 | 幂等

UPDATE sys_menu
SET parent_id = 92037,
    type = 3,
    name = '设置技能权限',
    path = NULL,
    component = NULL,
    icon = NULL,
    sort = 3,
    visible = 1,
    updated_at = NOW()
WHERE id = 92038
  AND type = 2;
