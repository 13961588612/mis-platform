package com.mis.adminbff.support.embed;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@link PhoneHash} 单测（R3/R5：脱敏存储 + 日志脱敏）。
 */
class PhoneHashTest {

    @Test
    @DisplayName("R5：phone_hash = sha256(phone + salt)，64 位 hex，稳定可复现")
    void hashStable() {
        String h1 = PhoneHash.hash("13800138000", "salt");
        String h2 = PhoneHash.hash("13800138000", "salt");

        assertTrue(h1 != null && h1.length() == 64);
        assertEquals(h1, h2);
        // 不同 salt 不同哈希
        assertNotEquals(h1, PhoneHash.hash("13800138000", "other-salt"));
        // 不同 phone 不同哈希
        assertNotEquals(h1, PhoneHash.hash("13800138001", "salt"));
        // 不加盐（空 salt）仍可复现
        assertEquals(PhoneHash.hash("13800138000", ""), PhoneHash.hash("13800138000", ""));
    }

    @Test
    @DisplayName("空 phone → null（不产生哈希）")
    void blankPhone() {
        assertNull(PhoneHash.hash(null, "salt"));
        assertNull(PhoneHash.hash("  ", "salt"));
    }

    @Test
    @DisplayName("R3：日志脱敏号 138****8000，短号也安全")
    void mask() {
        assertEquals("138****8000", PhoneHash.mask("13800138000"));
        assertEquals("", PhoneHash.mask(null));
        assertEquals("", PhoneHash.mask("  "));
        // 6 位以内的短号直接全掩
        assertEquals("****", PhoneHash.mask("12345"));
    }
}
