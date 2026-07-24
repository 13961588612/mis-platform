package com.mis.adminbff.dto.ai;

import java.util.List;

/**
 * {@code POST /api/v1/ai/rag} 响应 data。
 *
 * <p>由平台 mis-rag Agent 返回的结构化 JSON（{@code answer} / {@code citations}）解析而来。
 */
public class AiRagResponse {

    /** 回答文本。 */
    private String answer;

    /** 引用来源列表。 */
    private List<AiRagCitation> citations = List.of();

    /** 平台会话 ID。 */
    private String sessionId;

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
        this.citations = citations;
    }

    public String getSessionId() {
        return sessionId;
    }

    public void setSessionId(String sessionId) {
        this.sessionId = sessionId;
    }
}
