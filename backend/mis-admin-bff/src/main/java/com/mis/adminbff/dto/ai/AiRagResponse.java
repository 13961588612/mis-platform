package com.mis.adminbff.dto.ai;

import java.util.List;

/**
 * {@code POST /api/v1/ai/rag} 响应 data。
 *
 * <p>由平台 mis-rag Agent 返回的结构化 JSON（{@code answer} / {@code citations}）解析而来。
 *
 * <p>T10：区分两类会话标识——
 * <ul>
 *   <li>{@link #sessionId}：ai-platform 自身的会话 UUID（保持原语义，通用 RAG 面板使用）</li>
 *   <li>{@link #kbSessionId}：mis-kb 的问答会话数值 ID（知识库问答页据此拉取历史、提交反馈）</li>
 * </ul>
 * 未走 KB 问答管线时 {@code kbSessionId} / {@code messageId} 为 null。
 */
public class AiRagResponse {

    /** 回答文本。 */
    private String answer;

    /** 引用来源列表。 */
    private List<AiRagCitation> citations = List.of();

    /** 平台会话 ID（UUID）。 */
    private String sessionId;

    /** mis-kb 问答会话 ID（数值），仅 KB 问答管线命中时非空。 */
    private Long kbSessionId;

    /** mis-kb 助手消息 ID（数值），反馈提交时使用。 */
    private Long messageId;

    public String getAnswer() {
        return answer;
    }

    public void setAnswer(String answer) {
        this.answer = answer;
    }

    public List<AiRagCitation> getCitations() {
        return citations;
    }

    public void setCitations(List<AiRagCitation> citations) {
        this.citations = citations == null ? List.of() : citations;
    }

    public String getSessionId() {
        return sessionId;
    }

    public void setSessionId(String sessionId) {
        this.sessionId = sessionId;
    }

    public Long getKbSessionId() {
        return kbSessionId;
    }

    public void setKbSessionId(Long kbSessionId) {
        this.kbSessionId = kbSessionId;
    }

    public Long getMessageId() {
        return messageId;
    }

    public void setMessageId(Long messageId) {
        this.messageId = messageId;
    }
}
