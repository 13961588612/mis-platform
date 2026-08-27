package com.mis.recon.domain.ledger;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * 消费游标（recon_consume_cursor，V1 239~247 行，per-check 粒度）。纯 POJO（G1）。
 * <p>T04 建好（F67），T05 ReconRunner 消费。</p>
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ReconConsumeCursor {

    private Long id;
    private String scenarioCode;
    private String checkName;
    private String dsCode;
    private Long cursorSeq;      // 已消费到的最大 update_seq
    private LocalDateTime updatedAt;
}
