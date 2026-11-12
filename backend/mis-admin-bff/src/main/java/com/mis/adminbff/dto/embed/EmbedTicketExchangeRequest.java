package com.mis.adminbff.dto.embed;

import jakarta.validation.constraints.NotBlank;

/**
 * Ticket 嵌入身份兑换请求（POST /api/v1/embed/identity/ticket-exchange）。
 *
 * <p>由 MIS embed 同源页调用；浏览器不持有出站密钥。BFF 服务端向外部验票后映射并发 JWT。
 */
public record EmbedTicketExchangeRequest(
        @NotBlank(message = "hostId 不能为空")
        String hostId,
        @NotBlank(message = "ticket 不能为空")
        String ticket
) {
}
