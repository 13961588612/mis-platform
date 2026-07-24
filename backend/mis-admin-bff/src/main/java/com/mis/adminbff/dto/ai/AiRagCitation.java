package com.mis.adminbff.dto.ai;

/**
 * RAG 引用来源（{@code data.result.citations} 中的单项）。
 */
public class AiRagCitation {

    /** 来源名（如 hr-handbook.pdf）。 */
    private String source;

    /** 片段 / 章节（如 §3.2）。 */
    private String chunk;

    /** 相关性打分（0~1）。 */
    private Double score;

    public String getSource() {
        return source;
    }

    public void setSource(String source) {
        this.source = source;
    }

    public String getChunk() {
        return chunk;
    }

    public void setChunk(String chunk) {
        this.chunk = chunk;
    }

    public Double getScore() {
        return score;
    }

    public void setScore(Double score) {
        this.score = score;
    }
}
