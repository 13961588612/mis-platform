package com.mis.recon.domain.ledger;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * 已提交安全水位（recon_seq_watermark，V1 232~236 行，无 id，主键 ds_code）。纯 POJO（G1）。
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SeqWatermark {

    private String dsCode;
    private Long committedSeq;   // 已提交安全水位，ReconRunner 只能消费到此处
    private LocalDateTime updatedAt;
}
