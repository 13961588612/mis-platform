package com.mis.taskflow.dto;

/**
 * 流程边 DTO（设计器连线）。
 */
public record WfEdgeDTO(
        String source,
        String target,
        String edgeType,
        String label,
        String conditionExpr,
        Integer sortOrder
) {
}