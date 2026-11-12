-- ===========================================================================
-- V98__iqd_enhance_menu_rename_merge_instruction.sql
-- ① 菜单「IQD 脱敏与维度」(92509) 改名为「知识与规则」
-- ② 若存在独立「指令下发」可见页菜单，隐藏（指令已并入 /iqd/enhance?tab=instruction）
-- 前置：V73（92509 种子）、V77（path 改写为 /iqd/enhance）
-- 幂等：仅 UPDATE；不改权限码与 API 绑定。
-- ===========================================================================

UPDATE sys_menu
SET name = '知识与规则',
    updated_at = NOW()
WHERE id = 92509
  AND (name IS DISTINCT FROM '知识与规则');

-- 兜底：按路径改名（若 id 不一致但 path 仍指向 enhance 页）
UPDATE sys_menu
SET name = '知识与规则',
    updated_at = NOW()
WHERE path IN ('/iqd/enhance', '/ai/iqd/enhance')
  AND type = 1
  AND (name IS DISTINCT FROM '知识与规则');

-- 隐藏独立「指令下发」页（仅前端 fallback 曾登记；若库中有同类可见页则一并收口）
UPDATE sys_menu
SET visible = 0,
    updated_at = NOW()
WHERE type = 1
  AND path IN ('/iqd/instruction', '/ai/iqd/instruction')
  AND visible <> 0;
