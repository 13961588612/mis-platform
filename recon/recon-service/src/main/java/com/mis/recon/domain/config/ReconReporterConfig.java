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
 * 报告渠道配置（recon_reporter_config，V1 173~184 行）。T03 只建实体，CRUD 端点随 T07 落地。
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Entity
@Table(name = "recon_reporter_config")
@DynamicUpdate
public class ReconReporterConfig {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "scenario_code", length = 64, nullable = false)
    private String scenarioCode;

    @Column(name = "check_name", length = 128)
    private String checkName;

    @Column(length = 64, nullable = false)
    private String channel;

    @Column(name = "config_json")
    @JdbcTypeCode(SqlTypes.JSON)
    private String configJson;

    @Column(name = "min_severity", length = 16)
    private String minSeverity;

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
