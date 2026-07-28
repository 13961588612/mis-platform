package com.mis.common.core.util;

/**
 * 敏感字段脱敏（对齐 docs/architecture/03-security.md §9.3）。
 */
public final class DesensitizeUtils {

    private DesensitizeUtils() {}

    /** 手机号：138****0000 */
    public static String phone(String phone) {
        if (phone == null || phone.isBlank()) {
            return phone;
        }
        String s = phone.trim();
        if (s.length() < 7) {
            return "****";
        }
        if (s.length() == 11) {
            return s.substring(0, 3) + "****" + s.substring(7);
        }
        int keep = Math.min(3, s.length() / 3);
        return s.substring(0, keep) + "****" + s.substring(s.length() - keep);
    }

    /** 身份证：110***********1234 */
    public static String idCard(String idCard) {
        if (idCard == null || idCard.isBlank()) {
            return idCard;
        }
        String s = idCard.trim();
        if (s.length() < 8) {
            return "****";
        }
        return s.substring(0, 3) + "*".repeat(s.length() - 7) + s.substring(s.length() - 4);
    }

    public static String email(String email) {
        if (email == null || email.isBlank()) {
            return email;
        }
        String s = email.trim();
        int at = s.indexOf('@');
        if (at <= 1) {
            return "****" + (at >= 0 ? s.substring(at) : "");
        }
        return s.charAt(0) + "***" + s.substring(at);
    }
}
