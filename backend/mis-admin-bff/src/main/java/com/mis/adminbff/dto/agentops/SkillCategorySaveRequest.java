package com.mis.adminbff.dto.agentops;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** 新建 / 更新技能分类。 */
public record SkillCategorySaveRequest(
        @JsonProperty("parent_id") Long parentId,
        @NotBlank(message = "分类名称不能为空")
        @Size(max = 128, message = "分类名称不超过 128 字")
        String name,
        @JsonProperty("sort_order") Integer sortOrder) {
}
