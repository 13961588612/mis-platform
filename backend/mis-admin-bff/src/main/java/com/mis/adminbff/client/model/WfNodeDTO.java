package com.mis.adminbff.client.model;

public record WfNodeDTO(
        String nodeCode, String nodeName, String nodeType, Integer sortOrder,
        Double canvasX, Double canvasY, String conditionExpr, String assigneeRule,
        Integer timeoutHours, String config) {
}
