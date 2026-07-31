package com.mis.adminbff.service.skill;

/**
 * 单据写回的统一结果（设计 §4.4 / T04）。
 *
 * <p>{@code status} 取 {@code success} 或 {@code error}；{@code docId} 透传回填目标单据；
 * {@code message} 为用户可读提示。映射为 {@code SkillApplyResponse} 返回给调用方。
 */
public class DocWriteResult {

    private final String status;
    private final String docId;
    private final String message;

    private DocWriteResult(String status, String docId, String message) {
        this.status = status;
        this.docId = docId;
        this.message = message;
    }

    public static DocWriteResult success(String docId, String message) {
        return new DocWriteResult("success", docId, message);
    }

    public static DocWriteResult error(String docId, String message) {
        return new DocWriteResult("error", docId, message);
    }

    public String getStatus() {
        return status;
    }

    public String getDocId() {
        return docId;
    }

    public String getMessage() {
        return message;
    }
}
