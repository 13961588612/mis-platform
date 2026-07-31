package com.mis.adminbff.dto.ai;

import java.util.Map;

/**
 * Skill 执行结果 DTO（对应架构中的 SkillFillResult）。
 * 返回填充状态、字段结果及可能的 HITL 交互载荷。
 */
public class SkillExecuteResponse {

    /** 执行状态：success | hitl_required | manual_required | error。 */
    private String status = "";

    /** 填充结果，如 {"deptId": 12, "orgId": 3}。 */
    private Map<String, Object> fields = Map.of();

    /** HITL 交互载荷（仅 status 为 hitl_required 时有值）。 */
    private HitlPayload hitl;

    /** 错误信息或提示语。 */
    private String message = "";

    /** 用于 HITL resume 的 token（仅 status 为 hitl_required 时有值）。 */
    private String resumeToken;

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public Map<String, Object> getFields() {
        return fields;
    }

    public void setFields(Map<String, Object> fields) {
        this.fields = fields;
    }

    public HitlPayload getHitl() {
        return hitl;
    }

    public void setHitl(HitlPayload hitl) {
        this.hitl = hitl;
    }

    public String getMessage() {
        return message;
    }

    public void setMessage(String message) {
        this.message = message;
    }

    public String getResumeToken() {
        return resumeToken;
    }

    public void setResumeToken(String resumeToken) {
        this.resumeToken = resumeToken;
    }
}
