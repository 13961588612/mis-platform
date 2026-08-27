package com.mis.recon.domain.ledger;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * 源数据台账行（recon_source_record，V1 187~203 行）。
 * <p>纯 POJO（T04-spec G1：热路径走 JdbcTemplate，不挂 @Entity）；字段与 DDL 一一对应。</p>
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ReconSourceRecord {

    private Long id;
    private String dsCode;
    private String recordKey;          // 存储键（三层键·存储层，现算）
    private String recordData;         // JSONB 整行（写 CAST(? AS jsonb)）
    private LocalDateTime recordTime;  // ds.time_field 值
    private LocalDate bizDate;         // TRUNC(record_time)
    private Long updateSeq;            // nextval('recon_update_seq')（Java 先取号再传入）
    private Integer isDeleted;
    private LocalDateTime deletedAt;
    private Long amountCent;           // 标准化主金额：整数分带符号，可 null（V33）
    private String amountRaw;          // 源原始金额字符串（原始态只读）
    private String amountDirection;    // in(收)/out(付)/none(非资金行)
    private Long lastPullRunId;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
