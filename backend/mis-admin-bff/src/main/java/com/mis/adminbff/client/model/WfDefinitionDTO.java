package com.mis.adminbff.client.model;

import java.time.LocalDateTime;
import java.util.List;

public record WfDefinitionDTO(
        String id, String tenantId, String code, String name, String category, String description,
        Integer version, String status, List<String> supportedFormCodes, String formSchema, String config,
        List<WfNodeDTO> nodes, LocalDateTime createdAt, LocalDateTime updatedAt, Long categoryId) {
}
