package com.mis.taskflow.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * {@link PortalMattersService#toLocalDateTime(Object)} 类型分支单测
 * （覆盖 Hibernate 6 + PG native 查询常见的时间列类型，防「全部」Tab 发起时间空白回归）。
 */
class PortalMattersServiceTimeConvertTest {

    @Test
    @DisplayName("null → null")
    void nullStaysNull() {
        assertNull(PortalMattersService.toLocalDateTime(null));
    }

    @Test
    @DisplayName("LocalDateTime / Timestamp 原样或等价转换")
    void localDateTimeAndTimestamp() {
        LocalDateTime dt = LocalDateTime.of(2026, 10, 8, 10, 0, 0);
        assertEquals(dt, PortalMattersService.toLocalDateTime(dt));
        assertEquals(dt, PortalMattersService.toLocalDateTime(Timestamp.valueOf(dt)));
    }

    @Test
    @DisplayName("Instant / OffsetDateTime（Hibernate6+PG 常见）不丢成 null")
    void instantAndOffsetDateTime() {
        Instant instant = Instant.parse("2026-10-08T02:00:00Z");
        assertNotNull(PortalMattersService.toLocalDateTime(instant));

        OffsetDateTime odt = OffsetDateTime.of(2026, 10, 8, 10, 0, 0, 0, ZoneOffset.ofHours(8));
        assertEquals(LocalDateTime.of(2026, 10, 8, 10, 0, 0), PortalMattersService.toLocalDateTime(odt));
    }

    @Test
    @DisplayName("ISO 字符串可解析")
    void isoString() {
        assertEquals(
                LocalDateTime.of(2026, 10, 8, 10, 0, 0),
                PortalMattersService.toLocalDateTime("2026-10-08T10:00:00"));
        assertEquals(
                LocalDateTime.of(2026, 10, 8, 10, 0, 0),
                PortalMattersService.toLocalDateTime("2026-10-08 10:00:00"));
    }
}
