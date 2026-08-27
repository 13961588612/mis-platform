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
 * 数据源配置（recon_datasource，V1 50~89 行，27 业务字段）。
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Entity
@Table(name = "recon_datasource")
@DynamicUpdate
public class ReconDatasource {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "ds_code", length = 64, nullable = false)
    private String dsCode;

    @Column(length = 128)
    private String name;

    @Column(name = "conn_code", length = 64)
    private String connCode;

    @Column(name = "pull_cron", length = 64)
    private String pullCron;

    @Column(name = "record_key_expression", length = 256, nullable = false)
    private String recordKeyExpression;

    @Column(name = "time_field", length = 64)
    private String timeField;

    @Column(name = "fetch_type", length = 16)
    private String fetchType;

    @Column(name = "fetch_config_json")
    @JdbcTypeCode(SqlTypes.JSON)
    private String fetchConfigJson;

    @Column(name = "fields_json")
    @JdbcTypeCode(SqlTypes.JSON)
    private String fieldsJson;

    @Column(name = "health_rules_json")
    @JdbcTypeCode(SqlTypes.JSON)
    private String healthRulesJson;

    @Column(name = "amount_fields_json")
    @JdbcTypeCode(SqlTypes.JSON)
    private String amountFieldsJson;

    @Column(name = "refund_sign_rule", length = 16)
    private String refundSignRule;

    @Column(name = "refund_flag_expr", length = 200)
    private String refundFlagExpr;

    @Column(length = 16)
    private String grain;

    @Column(name = "group_by_fields", length = 256)
    private String groupByFields;

    @Column(name = "member_key_field", length = 64)
    private String memberKeyField;

    @Column(name = "key_scan_sql")
    private String keyScanSql;

    @Column(name = "agg_sql")
    private String aggSql;

    @Column(name = "agg_key_batch_size")
    private Integer aggKeyBatchSize;

    @Column(name = "agg_join_mode", length = 16)
    private String aggJoinMode;

    @Column(name = "agg_full_recompute_cron", length = 64)
    private String aggFullRecomputeCron;

    @Column(name = "mixed_direction")
    private Integer mixedDirection;

    @Column(name = "direction_key_field", length = 64)
    private String directionKeyField;

    @Column(name = "key_case_mode", length = 8)
    private String keyCaseMode;

    @Column(name = "delete_mode", length = 16)
    private String deleteMode;

    @Column(name = "soft_delete_expr", length = 200)
    private String softDeleteExpr;

    @Column(name = "delete_mode_evidence", length = 200)
    private String deleteModeEvidence;

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
