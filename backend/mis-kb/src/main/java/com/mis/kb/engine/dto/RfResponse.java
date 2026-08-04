package com.mis.kb.engine.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * RAGFlow 通用响应包络：{@code {code, data, message}}。
 *
 * <p>浏览器/BFF 禁止感知此结构；仅 mis-kb 内部适配层使用。
 */
public record RfResponse<T>(
        @JsonProperty("code") int code,
        @JsonProperty("data") T data,
        @JsonProperty("message") String message) {

    public boolean ok() {
        return code == 0;
    }
}
