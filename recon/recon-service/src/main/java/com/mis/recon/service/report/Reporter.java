package com.mis.recon.service.report;

import java.util.List;

/**
 * 报告渠道接口（T07-spec §3.3）：email / webhook 两渠道实现，ReporterFactory 分发。
 */
public interface Reporter {

    /** 渠道名：email / webhook */
    String channel();

    /** 发送报告内容；发送失败返回 SendResult.fail(errMsg)，不抛异常。 */
    SendResult send(ReportContent content);
}