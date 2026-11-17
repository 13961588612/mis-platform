package com.mis.recon.domain.query;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;

/**
 * 差异查询实体（recon_detail，T05-spec §11）：仅 DiffController 只读查询用（JPA Specification）。
 * <p>与 ledger 热路径 POJO 并存；<b>热路径严禁注入本 Repository</b>（依赖方向门禁）。</p>
 */
@Entity
@Table(name = "recon_detail")
@Getter
@Setter
public class ReconDetailEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String scenarioCode;

    @Column(nullable = false)
    private String checkName;

    @Column(nullable = false)
    private String pairSegment;

    @Column(nullable = false)
    private String matchKeyHash;

    private String matchKeyDisplay;

    @Column(nullable = false)
    private String diffType;

    @Column(nullable = false)
    private String status;

    private LocalDateTime deferUntil;

    private Long pendingPeerPullRunId;

    private String pendingPeerDsCode;

    private LocalDateTime pendingAt;

    @JdbcTypeCode(SqlTypes.JSON)
    private String leftDataJson;

    @JdbcTypeCode(SqlTypes.JSON)
    private String rightDataJson;

    private String diffDesc;

    private Long diffAmountCent;

    private Long diffPoint;    // 非货币计量（积分）差额原值（V5）

    @JdbcTypeCode(SqlTypes.JSON)
    private String diffDiagnosisJson;

    @Column(nullable = false)
    private String handleStatus;

    private LocalDateTime reportedAt;

    private Integer reopenSeq;

    private LocalDateTime resolvedAt;

    @Column(nullable = false)
    private LocalDateTime firstSeenAt;

    @Column(nullable = false)
    private LocalDateTime updatedAt;
}
