package com.mis.recon.domain.config;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.DynamicUpdate;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;

/**
 * 场景配置（recon_scenario，V1 92~111 行）。
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Entity
@Table(name = "recon_scenario")
@DynamicUpdate
public class ReconScenario {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "scenario_code", length = 64, nullable = false)
    private String scenarioCode;

    @Column(length = 128)
    private String name;

    @Column(name = "cron_expr", length = 64)
    private String cronExpr;

    @Column(name = "uses_json")
    @JdbcTypeCode(SqlTypes.JSON)
    private String usesJson;

    @Column(name = "hooks_json")
    @JdbcTypeCode(SqlTypes.JSON)
    private String hooksJson;

    @Column(name = "reporter_json")
    @JdbcTypeCode(SqlTypes.JSON)
    private String reporterJson;

    @Column(name = "report_cron", length = 64)
    private String reportCron;

    @Column(name = "report_type", length = 16)
    private String reportType;

    @Column(name = "pool_max_age_days")
    private Integer poolMaxAgeDays;

    @Column(name = "pending_max_wait_hours")
    private Integer pendingMaxWaitHours;

    @Column(name = "on_degraded", length = 16)
    private String onDegraded;

    @Column(name = "on_empty", length = 16)
    private String onEmpty;

    @Column(name = "on_error", length = 16)
    private String onError;

    @Column
    private Integer enabled;

    @Column(name = "created_at", insertable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", insertable = false)
    private LocalDateTime updatedAt;

    @PreUpdate
    public void preUpdate() {
        this.updatedAt = LocalDateTime.now();
    }
}
