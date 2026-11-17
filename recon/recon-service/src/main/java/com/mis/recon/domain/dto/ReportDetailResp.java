package com.mis.recon.domain.dto;

import com.mis.recon.dao.DashboardDao.ReportCheckSummary;
import com.mis.recon.dao.RunAuditDao.AlertLogRow;
import com.mis.recon.dao.RunAuditDao.ReportRunRow;
import lombok.AllArgsConstructor;
import lombok.Data;

import java.util.List;

/**
 * 报告详情响应（T07 前端接入补充）：报告运行记录 + 该次运行发送的报告正文 + 按检查分组差异汇总。
 * <p>alert_log 未落 report_run_id，正文按 scenario + 运行时间窗口关联（ReportRunner 写留痕发生在运行窗口内）。</p>
 */
@Data
@AllArgsConstructor
public class ReportDetailResp {

    /** 报告运行记录 */
    private ReportRunRow run;

    /** 该次运行产生的告警留痕（每 check 组一条，content 即发送的报告正文） */
    private List<AlertLogRow> alerts;

    /** 按检查分组汇总（差异条数 / 差异金额合计，金额单位分） */
    private List<ReportCheckSummary> checkSummaries;
}