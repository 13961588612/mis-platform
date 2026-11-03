package com.mis.aireport.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;

public record AiWorkflowPlatformSaveRequest(
        @NotBlank @JsonProperty("platform_code") String platformCode,
        @NotBlank String name,
        Boolean enabled) {
}
