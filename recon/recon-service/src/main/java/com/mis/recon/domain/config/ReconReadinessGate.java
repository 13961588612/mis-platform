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
 * 数据就绪门（recon_readiness_gate，V1 156~170 行）。T03 只建实体，CRUD 端点随 T07 落地。
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Entity
@Table(name = "recon_readiness_gate")
@DynamicUpdate
public class ReconReadinessGate {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "scenario_code", length = 64, nullable = false)
    private String scenarioCode;

    @Column(name = "gate_name", length = 128, nullable = false)
    private String gateName;

    @Column(name = "gate_type", length = 16, nullable = false)
    private String gateType;

    @Column(name = "gate_sql")
    private String gateSql;

    @Column(name = "gate_config_json")
    @JdbcTypeCode(SqlTypes.JSON)
    private String gateConfigJson;

    @Column(name = "min_wait_min")
    private Integer minWaitMin;

    @Column(name = "max_wait_min")
    private Integer maxWaitMin;

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
