package com.mis.taskflow.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * 新增/更新表单定义请求。
 *
 * <p>code 的格式约束与流程定义 code 保持同一套规则：{@code ^[A-Z][A-Z0-9_]{1,63}$}。
 *
 * <p>V149：工作流关联在本请求维护（{@code workflowBindingType} + 对应字段）；
 * 流程定义侧不再写关联。
 */
public record UpsertFormDefinitionRequest(
        Long categoryId,
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
        /** NONE / LOCAL / EXTERNAL；null 视为 NONE。 */
        String workflowBindingType,
        /** LOCAL 时必填：本地 {@code wf_definition.id}。 */
        Long workflowDefinitionId,
        /** EXTERNAL 时必填。 */
        @Size(max = 64, message = "外部工作流系统编码最长 64 字符")
        String externalWorkflowSystem,
        /** EXTERNAL 时必填。 */
        @Size(max = 256, message = "外部工作流标识最长 256 字符")
        String externalWorkflowRef,
        /** 自动填单 Agent；与 aiSkillId 成对，都空表示关闭。 */
        @Size(max = 64, message = "自动填单 Agent 最长 64 字符")
        String aiAgentId,
        /** 自动填单 Skill；与 aiAgentId 成对。 */
        @Size(max = 128, message = "自动填单 Skill 最长 128 字符")
        String aiSkillId
) {
    /** 兼容旧调用方（无工作流关联字段 → NONE；无 AI 填单）。 */
    public UpsertFormDefinitionRequest(Long categoryId, String code, String name, String description,
                                       String status, Integer sortOrder, String config) {
        this(categoryId, code, name, description, status, sortOrder, config, "NONE", null, null, null, null, null);
    }
}
