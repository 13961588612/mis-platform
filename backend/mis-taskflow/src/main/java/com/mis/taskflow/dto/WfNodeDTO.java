package com.mis.taskflow.dto;

/**
 * 流程节点 DTO（定义读写用）。
 */
public record WfNodeDTO(
        String nodeCode,
        String nodeName,
        String nodeType,
        Integer sortOrder,
        Double canvasX,
        Double canvasY,
        String conditionExpr,
        String assigneeRule,
        Integer timeoutHours,
        String config
) {
}
