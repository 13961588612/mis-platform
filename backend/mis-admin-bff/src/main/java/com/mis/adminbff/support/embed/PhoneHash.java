package com.mis.adminbff.support.embed;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/**
 * 手机号脱敏与哈希工具（D12 安全红线 R3/R5）。
 *
 * <ul>
 *   <li>{@link #hash(String, String)}：phone_hash = sha256(phone + salt)，
 *       仅作匹配键（R5 脱敏存储），不用于口令校验；</li>
 *   <li>{@link #mask(String)}：日志脱敏号 {@code 138****1234}（R3 手机号不落明文日志）。</li>
 * </ul>
 */
public final class PhoneHash {

    private PhoneHash() {
    }

    /**
     * 计算 phone_hash（sha256(phone + salt)，hex 小写）。
     *
     * @param phone 明文手机号（仅内存瞬时使用，绝不落库/日志）
     * @param salt  加盐串（可为空）
     * @return 64 位 hex 哈希；phone 为空返回 {@code null}
     */
    public static String hash(String phone, String salt) {
        if (phone == null || phone.isBlank()) {
            return null;
        }
        return sha256Hex(phone.trim() + (salt == null ? "" : salt));
    }

    /**
     * 通用 sha256 hex（client_secret 一致性校验等场景复用）。
     *
     * @param raw 原始输入
     * @return 64 位 hex 哈希（小写）
     */
    public static String sha256Hex(String raw) {
        if (raw == null) {
            return "";
        }
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = digest.digest(raw.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(bytes.length * 2);
            for (byte b : bytes) {
                sb.append(Character.forDigit((b >> 4) & 0xF, 16));
                sb.append(Character.forDigit(b & 0xF, 16));
            }
            return sb.toString();
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 不可用", ex);
        }
    }

    /**
     * 手机号脱敏（R3）：{@code 13800138000} → {@code 138****8000}。
     * 11 位手机号保留前 3 后 4；更短/更长的号码按前 3 后 3 脱敏。
     *
     * @param phone 明文手机号
     * @return 脱敏号；空返回空串
     */
    public static String mask(String phone) {
        if (phone == null || phone.isBlank()) {
            return "";
        }
        String value = phone.trim();
        if (value.length() >= 11) {
            return value.substring(0, 3) + "****" + value.substring(value.length() - 4);
        }
        if (value.length() > 6) {
            return value.substring(0, 3) + "****" + value.substring(value.length() - 3);
        }
        return "****";
    }
}
