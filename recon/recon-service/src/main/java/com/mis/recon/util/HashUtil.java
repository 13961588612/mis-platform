package com.mis.recon.util;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

/**
 * 哈希工具（F17）：SHA-256 hex，供 match_key_hash / 指纹去重使用。
 */
public final class HashUtil {

    private HashUtil() {
    }

    public static String sha256Hex(String input) {
        if (input == null) {
            input = "";
        }
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(md.digest(input.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            // JDK 必然携带 SHA-256，仅防御
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }
}
