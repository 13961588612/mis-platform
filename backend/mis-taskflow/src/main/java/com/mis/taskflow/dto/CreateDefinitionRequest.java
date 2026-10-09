package com.mis.taskflow.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;

import java.util.List;

/**
 * 创建/更新流程定义。
 */
public record CreateDefinitionRequest(
        @NotBlank String code,
        @NotBlank String name,
        String category,
        String description,
        List<String> supportedFormCodes,
        String config,
        @NotEmpty List<WfNodeDTO> nodes,
        List<WfEdgeDTO> edges
) {

    /** 便捷构造：省略 edges（无显式边时后端按 sortOrder 线性推进）。 */
    public CreateDefinitionRequest(String code, String name, String category, String description,
                                   List<String> supportedFormCodes, String config, List<WfNodeDTO> nodes) {
        this(code, name, category, description, supportedFormCodes, config, nodes, null);
    }
}
