package com.mis.adminbff.dto.ai;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * AI 平台 chat 端点响应中的 data 部分。
 *
 * <p>对应平台 {@code { code, data:{ response, session_id }, message, traceId }}。
 * 其中 {@code session_id} 为 snake_case，需显式映射。
 */
public class AiPlatformChatData {

    /** 模型生成的文本（summary/extract/rag 为结构化 JSON 字符串）。 */
    private String response;

    @JsonProperty("session_id")
    private String sessionId;

    public String getResponse() {
        return response;
    }

    public void setResponse(String response) {
        this.response = response;
    }

    public String getSessionId() {
        return sessionId;
    }

    public void setSessionId(String sessionId) {
        this.sessionId = sessionId;
    }
}
