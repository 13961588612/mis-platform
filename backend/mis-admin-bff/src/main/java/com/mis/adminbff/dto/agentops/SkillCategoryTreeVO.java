package com.mis.adminbff.dto.agentops;

import java.util.List;
import java.util.Map;

/**
 * 技能分类树 + 技能绑定。
 *
 * @param tree  根节点列表
 * @param binds skill_id → category_id
 */
public record SkillCategoryTreeVO(List<SkillCategoryVO> tree, Map<String, Long> binds) {
}
