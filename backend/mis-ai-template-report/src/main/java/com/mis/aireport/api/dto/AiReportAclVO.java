package com.mis.aireport.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

public class AiReportAclVO {

    private Long id;
    private String reportCode;
    private String subjectType;
    private String subjectId;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    @JsonProperty("report_code")
    public String getReportCode() {
        return reportCode;
    }

    public void setReportCode(String reportCode) {
        this.reportCode = reportCode;
    }

    @JsonProperty("subject_type")
    public String getSubjectType() {
        return subjectType;
    }

    public void setSubjectType(String subjectType) {
        this.subjectType = subjectType;
    }

    @JsonProperty("subject_id")
    public String getSubjectId() {
        return subjectId;
    }

    public void setSubjectId(String subjectId) {
        this.subjectId = subjectId;
    }
}
