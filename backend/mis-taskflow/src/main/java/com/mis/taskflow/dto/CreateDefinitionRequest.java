package com.mis.taskflow.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;

import java.util.List;

/**
 * 创建/更新流程定义。
 *
 * <p>categoryId（V131 新增）：指向 {@code wf_category.id} 的软引用（可空）。
 * 旧 {@code category} 字符串列保留废弃——新代码只用 {@code categoryId}。
 *
 * <p>既有 7 参 / 8 参调用点（含历史集成测试）通过便捷构造复用，categoryId 默认 {@code null}，
 * service 内部按「未指定即不写入」处理，不影响既有行为。
 */
public record CreateDefinitionRequest(
        @NotBlank String code,
        @NotBlank String name,
        String category,
        String description,
        List<String> supportedFormCodes,
        String config,
        @NotEmpty List<WfNodeDTO> nodes,
        List<WfEdgeDTO> edges,
        Long categoryId
) {

    /** 便捷构造：省略 edges（无显式边时后端按 sortOrder 线性推进），categoryId 为 null。 */
    public CreateDefinitionRequest(String code, String name, String category, String description,
                                   List<String> supportedFormCodes, String config, List<WfNodeDTO> nodes) {
        this(code, name, category, description, supportedFormCodes, config, nodes, null, null);
    }

    /** 便捷构造：含 edges、categoryId 为 null。 */
    public CreateDefinitionRequest(String code, String name, String category, String description,
                                   List<String> supportedFormCodes, String config, List<WfNodeDTO> nodes,
                                   List<WfEdgeDTO> edges) {
        this(code, name, category, description, supportedFormCodes, config, nodes, edges, null);
    }
}
