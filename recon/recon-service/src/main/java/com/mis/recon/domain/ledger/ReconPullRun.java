package com.mis.recon.domain.ledger;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * 拉取运行记录（recon_pull_run，V1 210~228 行）。纯 POJO（G1）。
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ReconPullRun {

    private Long id;
    private String dsCode;
    private LocalDateTime windowStart;   // 本次拉取窗口（业务库 update_time 区间）
    private LocalDateTime windowEnd;
    private Integer rowCount;            // 拉取行数
    private Integer insertCount;         // upsert 新增
    private Integer updateCount;         // upsert 更新
    private String healthStatus;         // healthy/degraded/empty/error
    private String healthDetailJson;     // JSONB
    private Integer readinessPassed;     // 就绪门（T04 恒 0）
    private Integer readinessDegraded;   // 超时降级（T04 恒 0）
    private String readinessLog;         // JSONB（T04 恒 null）
    private Integer clockSkewMs;         // 实测源库−平台毫秒（T04 可选）
    private String status;               // running/success/failed
    private String errMsg;               // TEXT
    private LocalDateTime startedAt;
    private LocalDateTime finishedAt;
}
