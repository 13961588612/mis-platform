package com.mis.adminbff.dto.ai;

/**
 * {@code POST /api/v1/ai/chat/completions} 响应 data（非流式）。
 *
 * <p>SSE 流式增强（chat/completions 直连）将改为 {@code Flux<ServerSentEvent>}，
 * 事件契约保持 {@code event: delta|done|error}，本结构对应单次完成时的 data。
 */
public class AiChatResponse {

    /** 模型生成的回复文本。 */
    private String content;

    /** 结束原因（如 stop）。 */
    private String finishReason = "stop";

    /** 平台会话 ID。 */
    private String sessionId;

    public String getContent() {
        return content;
    }

    public void setContent(String content) {
        this.content = content;
    }

    public String getFinishReason() {
        return finishReason;
    }

    public void setFinishReason(String finishReason) {
        this.finishReason = finishReason;
    }

    public String getSessionId() {
        return sessionId;
    }

    public void setSessionId(String sessionId) {
        this.sessionId = sessionId;
    }
}
