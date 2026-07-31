package com.mis.adminbff.dto.ai;

import java.util.List;

/**
 * HITL（Human-in-the-Loop）交互数据结构。
 * 当自动消歧失败时，将此载荷返回前端供用户手动选择。
 */
public class HitlPayload {

    /** 需要用户确认的字段名。 */
    private String field = "";

    /** 用户原始输入的值。 */
    private String originalValue = "";

    /** 候选列表，供用户选择。 */
    private List<EntityCandidate> candidates = List.of();

    public String getField() {
        return field;
    }

    public void setField(String field) {
        this.field = field;
    }

    public String getOriginalValue() {
        return originalValue;
    }

    public void setOriginalValue(String originalValue) {
        this.originalValue = originalValue;
    }

    public List<EntityCandidate> getCandidates() {
        return candidates;
    }

    public void setCandidates(List<EntityCandidate> candidates) {
        this.candidates = candidates;
    }
}
