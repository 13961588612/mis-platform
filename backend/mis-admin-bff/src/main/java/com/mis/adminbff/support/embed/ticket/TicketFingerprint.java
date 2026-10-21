package com.mis.adminbff.support.embed.ticket;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

/**
 * Ticket 指纹（日志/审计用）：不落明文 ticket，只记 sha256 前 12 位。
 */
public final class TicketFingerprint {

    private TicketFingerprint() {
    }

    /** @return 12 位小写 hex；空 ticket → 空串 */
    public static String of(String ticket) {
        if (ticket == null || ticket.isBlank()) {
            return "";
        }
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(ticket.trim().getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest).substring(0, 12);
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 unavailable", ex);
        }
    }
}
