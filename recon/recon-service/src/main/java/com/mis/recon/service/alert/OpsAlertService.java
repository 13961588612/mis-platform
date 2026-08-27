package com.mis.recon.service.alert;

import com.mis.recon.service.report.ReportContent;
import com.mis.recon.service.report.Reporter;
import com.mis.recon.service.report.ReporterFactory;
import com.mis.recon.service.report.SendResult;
import com.mis.recon.util.HashUtil;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

/**
 * 运维告警（F104，T07-spec §5，G29）：僵尸巡检等接入点调用。channel='ops'，
 * 指纹 = SHA-256(title|content) 防巡检重复；经应用配置通道（email，未配置 → 日志降级），写 alert_log 同表留痕。
 * <p>不在 PullRunner/ReconRunner 热路径内嵌告警（异常已由 run 收尾失败，巡检兜底收敛）。</p>
 */
@Slf4j
@Service
public class OpsAlertService {

    private final AlertLogService alertLogService;
    private final ReporterFactory reporterFactory;

    public OpsAlertService(AlertLogService alertLogService, ReporterFactory reporterFactory) {
        this.alertLogService = alertLogService;
        this.reporterFactory = reporterFactory;
    }

    /**
     * 发送一条运维告警并留痕。
     *
     * @param severity info / warn / critical
     */
    public void alertOps(String title, String content, String severity) {
        String fingerprint = HashUtil.sha256Hex(title + "|" + content);
        if (alertLogService.exists(fingerprint)) {
            log.info("[alert][ops] fingerprint dup, skip: {}", fingerprint);
            return;
        }
        Reporter email = reporterFactory.get("email");
        ReportContent report = new ReportContent(null, null, title, content, severity);
        SendResult result = email.send(report);
        String sendStatus = result.isSuccess() ? "success" : "failed";
        alertLogService.record(null, null, null, severity, "ops", fingerprint, content, sendStatus, result.getError());
        log.warn("[alert][ops] sent title={} severity={} sendStatus={}", title, severity, sendStatus);
    }
}