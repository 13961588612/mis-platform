package com.mis.org.service;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

/** 层级 code 生成算法单测（与 {@link DeptService#generateCode} 一致）。 */
class DeptCodeGeneratorTest {

    @Test
    void rootThenChildCodesFollowFourDigitSegments() {
        assertEquals("0001", nextCode("", List.of()));
        assertEquals("00010001", nextCode("0001", List.of()));
        assertEquals("00010002", nextCode("0001", List.of("00010001")));
        assertEquals("000100010001", nextCode("00010001", List.of()));
        assertEquals("0003", nextCode("", List.of("0001", "0002")));
    }

    private static String nextCode(String prefix, List<String> siblingCodes) {
        int maxSeq = 0;
        for (String code : siblingCodes) {
            if (code == null) {
                continue;
            }
            String suffix;
            if (prefix.isEmpty()) {
                if (code.length() != 4) {
                    continue;
                }
                suffix = code;
            } else {
                if (!code.startsWith(prefix) || code.length() != prefix.length() + 4) {
                    continue;
                }
                suffix = code.substring(prefix.length());
            }
            maxSeq = Math.max(maxSeq, Integer.parseInt(suffix));
        }
        return prefix + String.format("%04d", maxSeq + 1);
    }
}
