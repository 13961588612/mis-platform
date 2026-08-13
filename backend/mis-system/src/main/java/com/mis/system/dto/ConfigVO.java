package com.mis.system.dto;

import java.time.Instant;

/**
 * 系统参数展示 VO。
 */
public record ConfigVO(
        String id,
        String configKey,
        String configValue,
        String remark,
        Instant createdAt,
        Instant updatedAt
) {}
