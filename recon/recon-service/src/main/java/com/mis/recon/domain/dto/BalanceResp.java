package com.mis.recon.domain.dto;

import com.mis.recon.dao.DashboardDao.DatasourceHealthRow;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 平衡表（零差异证明）响应（T07 前端接入补充）：
 * 覆盖窗口 / 覆盖轮次 / 平衡结论 / 参与数据源健康 / 对账结果 / 本期变动 / 轮次完整性。
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class BalanceResp {

    /** 场景编码 */
    private String scenarioCode;

    /** 统计周期窗口 */
    private LocalDateTime windowStart;
    private LocalDateTime windowEnd;

    /** 覆盖轮次：窗口内成功轮数 / 总轮数 */
    private int coveredRounds;
    private int totalRounds;

    /** 平衡结论：balanced / unbalanced / no_run */
    private String conclusion;
    /** 平衡结论可读文案 */
    private String conclusionText;

    /** 参与数据源健康（启用数据源总览） */
    private List<DatasourceHealthRow> datasourceHealth;

    /** 对账结果（最近成功轮 matched / resolved + 当前池按差异类型分布） */
    private long matchedCount;
    private long fieldMismatch;
    private long unmatchedLeft;
    private long unmatchedRight;
    private long anomaly;
    private long resolvedCount;

    /** 本期变动 */
    private long newDiff;
    private long resolvedDiff;
    private long endPoolCount;

    /** 轮次完整性 */
    private long skippedRounds;
    private long failedRounds;
}