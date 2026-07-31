package com.mis.adminbff.dto.ai;

import java.util.Map;

/**
 * 单据回填请求 DTO（设计 §4.4 / T04）。
 *
 * <p>由 ai-platform 的 formfill_apply 工具发起，经反向信任头调用 BFF
 * {@code POST /api/v1/ai/skill/apply}。复用既有 Skill 上下文，不新增引擎字段。
 */
public class SkillApplyRequest {

    /** 触发回填的 Skill ID（如 user-fill），用于审计/追踪。 */
    private String skillId = "";

    /** 目标单据类型（路由键），如 purchase-order。 */
    private String docType = "";

    /** 目标单据 ID，如 PO-2026-001。 */
    private String docId = "";

    /** FormFill 返回的字段值，写回目标单据。 */
    private Map<String, Object> values = Map.of();

    public String getSkillId() {
        return skillId;
    }

    public void setSkillId(String skillId) {
        this.skillId = skillId;
    }

    public String getDocType() {
        return docType;
    }

    public void setDocType(String docType) {
        this.docType = docType;
    }

    public String getDocId() {
        return docId;
    }

    public void setDocId(String docId) {
        this.docId = docId;
    }

    public Map<String, Object> getValues() {
        return values;
    }

    public void setValues(Map<String, Object> values) {
        this.values = values;
    }
}
