package com.mis.aireport.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;

public record AiReportAclSaveRequest(
        @NotBlank @JsonProperty("report_code") String reportCode,
        @NotBlank @JsonProperty("subject_type") String subjectType,
        @NotBlank @JsonProperty("subject_id") String subjectId) {
}
