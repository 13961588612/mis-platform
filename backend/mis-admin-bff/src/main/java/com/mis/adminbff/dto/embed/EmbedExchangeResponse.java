package com.mis.adminbff.dto.embed;

import java.util.List;

/**
 * D12 嵌入身份兑换成功响应（01-architecture §4.3 契约）。
 *
 * <pre>
 * { code: 0, data: { misJwt, expiresIn, mappedUserId, mappedBy, permissions } }
 * </pre>
 */
public record EmbedExchangeResponse(
        /** 短时 RS256 MIS JWT（TTL 30min，含 userId/username/roles） */
        String misJwt,
        /** 有效期（秒） */
        long expiresIn,
        /** 映射到的 MIS userId（脱敏展示口径由前端决定） */
        String mappedUserId,
        /** 映射来源：explicit | phone | shadow */
        String mappedBy,
        /** 映射用户当前权限码集合（与 /internal/permissions 同源） */
        List<String> permissions
) {
}
