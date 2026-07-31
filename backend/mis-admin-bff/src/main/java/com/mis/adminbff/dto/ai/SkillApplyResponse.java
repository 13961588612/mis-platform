package com.mis.adminbff.dto.ai;

/**
 * 单据回填响应 DTO（设计 §4.4 / T04）。
 *
 * <p>与 {@link SkillExecuteResponse} 同构：{@code status} ∈ success|error；
 * {@code docId} 透传回填目标单据；{@code message} 为用户可读提示。
 * 经 {@code Result} 信封返回 Controller，ai-platform 侧经 {@code .data} 解包（与 execute 一致）。
 */
public class SkillApplyResponse {

    /** 回填状态：success | error。 */
    private String status = "";

    /** 回填目标单据 ID（原样回传）。 */
    private String docId = "";

    /** 用户可读提示语。 */
    private String message = "";

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public String getDocId() {
        return docId;
    }

    public void setDocId(String docId) {
        this.docId = docId;
    }

    public String getMessage() {
        return message;
    }

    public void setMessage(String message) {
        this.message = message;
    }
}
