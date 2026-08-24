package com.mis.iqd.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * 表级 ACL 响应 VO（GET /api/v1/iqd/acl；snake_case wire）。
 */
public class IqdAclVO {

    private Long id;
    private Long connectionId;
    private String subjectType;
    private String subjectId;
    private String itemKey;
    private String action;
    private String rowScope;

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

    public String getAction() {
        return action;
    }

    public void setAction(String action) {
        this.action = action;
    }

    public String getRowScope() {
        return rowScope;
    }

    public void setRowScope(String rowScope) {
        this.rowScope = rowScope;
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

    @JsonProperty("row_scope")
    public String rowScopeWire() {
        return rowScope;
    }
}
