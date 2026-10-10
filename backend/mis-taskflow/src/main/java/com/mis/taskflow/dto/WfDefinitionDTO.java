package com.mis.taskflow.dto;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 流程定义视图（含节点）。
 *
 * @param categoryId 流程分类 id（V131 新增，指向 wf_category.id，可空；旧 category 列保留废弃）
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
        LocalDateTime updatedAt,
        Long categoryId
) {
}
