package com.mis.aireport.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;

import java.util.List;
import java.util.Map;

public record AiReportDefSaveRequest(
        @NotBlank @JsonProperty("report_code") String reportCode,
        @NotBlank String title,
        String description,
        @JsonProperty("category_id") Long categoryId,
        List<Map<String, Object>> slots,
        @JsonProperty("use_ai_workflow") Boolean useAiWorkflow,
        @JsonProperty("workflow_platform_code") String workflowPlatformCode,
        @JsonProperty("workflow_code") String workflowCode,
        @JsonProperty("sort_order") Integer sortOrder,
        Boolean enabled) {
}
