package com.mis.iqd.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * 范围策略响应 VO（GET /api/v1/iqd/scope/policies；snake_case wire）。
 */
public class IqdScopePolicyVO {

    private Long id;
    private Long connectionId;
    private String subjectType;
    private String subjectId;
    private String itemKey;
    private Boolean allow;
    private Boolean effective;
    private String remark;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public Long getConnectionId() {
        return connectionId;
    }

    public void setConnectionId(Long connectionId) {
        this.connectionId = connectionId;
    }

    public String getSubjectType() {
        return subjectType;
    }

    public void setSubjectType(String subjectType) {
        this.subjectType = subjectType;
    }

    public String getSubjectId() {
        return subjectId;
    }

    public void setSubjectId(String subjectId) {
        this.subjectId = subjectId;
    }

    public String getItemKey() {
        return itemKey;
    }

    public void setItemKey(String itemKey) {
        this.itemKey = itemKey;
    }

    public Boolean getAllow() {
        return allow;
    }

    public void setAllow(Boolean allow) {
        this.allow = allow;
    }

    public Boolean getEffective() {
        return effective;
    }

    public void setEffective(Boolean effective) {
        this.effective = effective;
    }

    public String getRemark() {
        return remark;
    }

    public void setRemark(String remark) {
        this.remark = remark;
    }

    @JsonProperty("subject_type")
    public String subjectTypeWire() {
        return subjectType;
    }

    @JsonProperty("subject_id")
    public String subjectIdWire() {
        return subjectId;
    }

    @JsonProperty("item_key")
    public String itemKeyWire() {
        return itemKey;
    }
}
