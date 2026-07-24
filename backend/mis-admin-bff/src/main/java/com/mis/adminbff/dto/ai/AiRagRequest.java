package com.mis.adminbff.dto.ai;

import java.util.Map;

/**
 * {@code POST /api/v1/ai/rag} 请求体（知识库问答）。
 */
public class AiRagRequest {

    /** 能力标识（如 kb-qa）。 */
    private String capability;

    /** 用户问题。 */
    private String question;

    /** 知识库标识（如 hr-policy）。 */
    private String kb;

    /** 页面上下文（bizType 等）。 */
    private Map<String, Object> context = Map.of();

    /** 召回条数（可选）。 */
    private Integer topK;

    public String getCapability() {
        return capability;
    }

    public void setCapability(String capability) {
        this.capability = capability;
    }

    public String getQuestion() {
        return question;
    }

    public void setQuestion(String question) {
        this.question = question;
    }

    public String getKb() {
        return kb;
    }

    public void setKb(String kb) {
        this.kb = kb;
    }

    public Map<String, Object> getContext() {
        return context;
    }

    public void setContext(Map<String, Object> context) {
        this.context = context;
    }

    public Integer getTopK() {
        return topK;
    }

    public void setTopK(Integer topK) {
        this.topK = topK;
    }
}
