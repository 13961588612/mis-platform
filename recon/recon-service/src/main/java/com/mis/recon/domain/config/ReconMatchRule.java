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
 * 匹配规则（recon_match_rule，V1 128~142 行）。
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Entity
@Table(name = "recon_match_rule")
@DynamicUpdate
public class ReconMatchRule {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "scenario_code", length = 64, nullable = false)
    private String scenarioCode;

    @Column(name = "check_name", length = 128, nullable = false)
    private String checkName;

    @Column(length = 32, nullable = false)
    private String strategy;

    @Column(name = "datasets_json")
    @JdbcTypeCode(SqlTypes.JSON)
    private String datasetsJson;

    @Column(name = "key_fields_json")
    @JdbcTypeCode(SqlTypes.JSON)
    private String keyFieldsJson;

    @Column(name = "field_transform_json")
    @JdbcTypeCode(SqlTypes.JSON)
    private String fieldTransformJson;

    @Column(name = "multi_row_json")
    @JdbcTypeCode(SqlTypes.JSON)
    private String multiRowJson;

    @Column(name = "custom_class", length = 256)
    private String customClass;

    @Column(name = "config_json")
    @JdbcTypeCode(SqlTypes.JSON)
    private String configJson;

    @Column(name = "created_at", insertable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", insertable = false)
    private LocalDateTime updatedAt;

    @PreUpdate
    public void preUpdate() {
        this.updatedAt = LocalDateTime.now();
    }
}
