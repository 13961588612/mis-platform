package com.mis.adminbff.dto.agentops;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * 绑定技能到分类。{@code category_id} 为空则解除绑定。
 */
public record SkillCategoryBindRequest(@JsonProperty("category_id") Long categoryId) {
}
