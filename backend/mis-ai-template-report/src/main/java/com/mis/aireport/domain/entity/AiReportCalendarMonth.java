package com.mis.aireport.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDate;

@Entity
@Table(name = "ai_report_calendar_month")
public class AiReportCalendarMonth {

    @Id
    @Column(name = "ord_month")
    private String ordMonth;

    @Column(nullable = false, length = 64)
    private String label;

    @Column(name = "month_start", nullable = false)
    private LocalDate monthStart;

    @Column(name = "month_end", nullable = false)
    private LocalDate monthEnd;

    @JdbcTypeCode(SqlTypes.SMALLINT)
    @Column(nullable = false)
    private Integer enabled = 1;

    public String getOrdMonth() {
        return ordMonth;
    }

    public void setOrdMonth(String ordMonth) {
        this.ordMonth = ordMonth;
    }

    public String getLabel() {
        return label;
    }

    public void setLabel(String label) {
        this.label = label;
    }

    public LocalDate getMonthStart() {
        return monthStart;
    }

    public void setMonthStart(LocalDate monthStart) {
        this.monthStart = monthStart;
    }

    public LocalDate getMonthEnd() {
        return monthEnd;
    }

    public void setMonthEnd(LocalDate monthEnd) {
        this.monthEnd = monthEnd;
    }

    public Integer getEnabled() {
        return enabled;
    }

    public void setEnabled(Integer enabled) {
        this.enabled = enabled;
    }
}
