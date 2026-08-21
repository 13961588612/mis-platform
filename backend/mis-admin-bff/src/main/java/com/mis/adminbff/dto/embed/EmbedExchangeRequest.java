package com.mis.adminbff.dto.embed;

import jakarta.validation.constraints.NotBlank;

import java.util.List;

/**
 * D12 嵌入身份兑换请求（POST /api/v1/embed/identity/exchange）。
 *
 * <p>调用方为外部系统后端（内网/HTTPS），携带宿主自签 externalToken。
 * 请求体中的 {@code externalUserId} / {@code phone} 为<b>冗余字段</b>，
 * 以 token 内 claim 为准（P4：身份不受信，只信验签结果）。
 */
public record EmbedExchangeRequest(
        /** 宿主注册标识（如 crm-web） */
        @NotBlank(message = "hostId 不能为空")
        String hostId,
        /** 外部身份令牌（HS256，宿主用 client_secret 签发，含 externalUserId/phone/iat/exp） */
        @NotBlank(message = "externalToken 不能为空")
        String externalToken,
        /** 冗余字段，以 token 内为准（P4） */
        String externalUserId,
        /** 冗余字段，以 token 内为准（P4） */
        String phone,
        /** 可选：申请的最小权限范围（影子账号场景服务端校验 scope ⊆ 影子账号权限码） */
        List<String> scope
) {
}
