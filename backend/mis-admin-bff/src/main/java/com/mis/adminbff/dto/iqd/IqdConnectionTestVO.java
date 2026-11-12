package com.mis.adminbff.dto.iqd;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * 连通性自检结果（BFF 代理 POST /api/v1/iqd/config/test）。
 *
 * <p>与 mis-iqd {@code IqdAdminService.testConnection()} 的 snake_case wire 对齐（§4.3）。
 *
 * @param status        ok / failed / inactive / unknown
 * @param latencyMs     探活耗时（毫秒；可空）
 * @param message       探活消息（可空）
 * @param lastHealthAt  最近探活时间（ISO；可空）
 */
public record IqdConnectionTestVO(
        String status,
        @JsonProperty("latency_ms") Long latencyMs,
        String message,
        @JsonProperty("last_health_at") String lastHealthAt) {
}
