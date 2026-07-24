package com.mis.adminbff.dto.ai;

import java.util.List;
import java.util.Map;

/**
 * {@code POST /api/v1/ai/chat/completions} 请求体（Copilot 全局对话）。
 *
 * <p>T-stream（阶段5 后端扩展）：新增 {@code stream} 开关，{@code true} 时 BFF 走 SSE 透传
 * 平台 {@code /agents/{id}/chat/stream}；缺省/ false 走原非流式缓冲返回。
 */
public class AiChatRequest {

    /** 对话消息历史（role / content）。 */
    private List<AiChatMessage> messages = List.of();

    /** 页面上下文（pageId / selectedRows 等，selectedRows 已由上游脱敏）。 */
    private Map<String, Object> context = Map.of();

    /** 是否走 SSE 流式透传（T-stream）。缺省 false。 */
    private Boolean stream = Boolean.FALSE;

    public List<AiChatMessage> getMessages() {
        return messages;
    }

    public void setMessages(List<AiChatMessage> messages) {
        this.messages = messages;
    }

    public Map<String, Object> getContext() {
        return context;
    }

    public void setContext(Map<String, Object> context) {
        this.context = context;
    }

    public Boolean getStream() {
        return stream;
    }

    public void setStream(Boolean stream) {
        this.stream = stream;
    }
}
