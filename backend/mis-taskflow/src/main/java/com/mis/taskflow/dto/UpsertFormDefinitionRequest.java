package com.mis.taskflow.dto;

import com.mis.taskflow.domain.entity.FormDefinition;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * 新增/更新表单定义请求。
 *
 * <p>code 的格式约束与流程定义 code 保持同一套规则：{@code ^[A-Z][A-Z0-9_]{1,63}$}。
 * code 大小写敏感（前端注册表 key 精确匹配），故只允许大写。
 *
 * <p>kind（V131 新增）：{@link FormDefinition#KIND_CATEGORY} 纯文件夹 / {@link FormDefinition#KIND_FORM}
 * 真实表单。必填——前端必须在「表单注册」与「分类管理」两个 Tab 显式区分。
 * 历史接口（如既有集成测试直连 service）走 7 参便捷构造，kind 取 {@code null}，
 * service 内部归一化为 {@link FormDefinition#KIND_FORM}，不影响既有行为。
 */
public record UpsertFormDefinitionRequest(
        Long parentId,
        @NotBlank(message = "表单编码不能为空")
        @Pattern(regexp = "^[A-Z][A-Z0-9_]{1,63}$", message = "表单编码须为 ^[A-Z][A-Z0-9_]{1,63}$")
        String code,
        @NotBlank(message = "表单名称不能为空")
        @Size(max = 128, message = "表单名称最长 128 字符")
        String name,
        @Size(max = 2000, message = "说明最长 2000 字符")
        String description,
        String status,
        Integer sortOrder,
        String config,
        @NotBlank(message = "节点类型(kind)不能为空")
        String kind
) {
    /** 便捷构造：省略 kind（直连 service 的既有调用点沿用，归一化为 FORM）。 */
    public UpsertFormDefinitionRequest(Long parentId, String code, String name, String description,
                                      String status, Integer sortOrder, String config) {
        this(parentId, code, name, description, status, sortOrder, config, null);
    }
}
