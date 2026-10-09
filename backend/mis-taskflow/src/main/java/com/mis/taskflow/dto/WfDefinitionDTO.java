package com.mis.taskflow.dto;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 流程定义视图（含节点）。
 */
public record WfDefinitionDTO(
        String id,
        String tenantId,
        String code,
        String name,
        String category,
        String description,
        Integer version,
        String status,
        List<String> supportedFormCodes,
        String formSchema,
        String config,
        List<WfNodeDTO> nodes,
        List<WfEdgeDTO> edges,
        LocalDateTime createdAt,
        LocalDateTime updatedAt
) {
}
