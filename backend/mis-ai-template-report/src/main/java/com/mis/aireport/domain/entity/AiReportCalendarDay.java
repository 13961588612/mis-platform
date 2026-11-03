package com.mis.aireport.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDate;

@Entity
@Table(name = "ai_report_calendar_day")
public class AiReportCalendarDay {

    @Id
    @Column(name = "biz_date")
    private LocalDate bizDate;

    @Column(nullable = false, length = 64)
    private String label;

    @JdbcTypeCode(SqlTypes.SMALLINT)
    @Column(nullable = false)
    private Integer enabled = 1;

    public LocalDate getBizDate() {
        return bizDate;
    }

    public void setBizDate(LocalDate bizDate) {
        this.bizDate = bizDate;
    }

    public String getLabel() {
        return label;
    }

    public void setLabel(String label) {
        this.label = label;
    }

    public Integer getEnabled() {
        return enabled;
    }

    public void setEnabled(Integer enabled) {
        this.enabled = enabled;
    }
}
