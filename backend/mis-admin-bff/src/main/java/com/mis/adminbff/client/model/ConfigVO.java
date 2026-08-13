package com.mis.adminbff.client.model;

import java.time.Instant;

/**
 * 系统参数 VO（BFF 透传 mis-system ConfigVO）。
 */
public record ConfigVO(
        String id,
        String configKey,
        String configValue,
        String remark,
        Instant createdAt,
        Instant updatedAt
) {}
