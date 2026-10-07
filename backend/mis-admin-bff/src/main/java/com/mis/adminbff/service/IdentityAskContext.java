package com.mis.adminbff.service;

import org.springframework.http.HttpHeaders;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 问数 / Copilot 共用的身份 enrichment 快照（与 {@code X-Mis-*} 头同构）。
 *
 * @param userId  MIS userId
 * @param headers 头名 → JSON 字符串（仅含非空项）
 */
public record IdentityAskContext(Long userId, Map<String, String> headers) {

    public IdentityAskContext {
        headers = headers == null ? Map.of() : Collections.unmodifiableMap(new LinkedHashMap<>(headers));
    }

    /** 写入下游 HTTP 头（BFF → ai-platform REST 快路径）。 */
    public void applyTo(HttpHeaders httpHeaders) {
        if (httpHeaders == null) {
            return;
        }
        for (Map.Entry<String, String> entry : headers.entrySet()) {
            if (entry.getKey() != null && entry.getValue() != null && !entry.getValue().isBlank()) {
                httpHeaders.set(entry.getKey(), entry.getValue());
            }
        }
    }
}
