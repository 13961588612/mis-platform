package com.mis.adminbff.dto.kb;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

/**
 * 新增分类节点管理员授权请求（BFF 侧镜像，纯透传）。
 *
 * @param subjectType 主体类型 user/role/dept
 * @param subjectId   主体 id
 */
public record KbCategoryAdminCreateRequest(
        @NotBlank(message = "主体类型不能为空") String subjectType,
        @NotNull(message = "主体 id 不能为空") Long subjectId) {
}
