package com.mis.recon.service.alert;

import com.mis.recon.service.report.ReporterFactory;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 运维告警单测（T07-spec §5 G29）：未配置渠道 → 降级 mock 发送 + 写 alert_log。
 */
class OpsAlertServiceTest {

    private AlertLogService alertLogService;
    private OpsAlertService service;

    @BeforeEach
    void setUp() {
        alertLogService = mock(AlertLogService.class);
        // 空渠道列表：任何 channel 都走 MOCK（日志降级 mock 成功）
        ReporterFactory factory = new ReporterFactory(List.of());
        service = new OpsAlertService(alertLogService, factory);
    }

    @Test
    void alertOpsRecordsAlertLog() {
        when(alertLogService.exists(anyString())).thenReturn(false);
        service.alertOps("僵尸运行", "pull_run 1 个已置 failed", "critical");
        verify(alertLogService).record(any(), any(), any(), anyString(), anyString(),
                anyString(), anyString(), anyString(), any());
    }

    @Test
    void duplicateFingerprintSkipsAlert() {
        when(alertLogService.exists(anyString())).thenReturn(true);
        service.alertOps("对账引擎僵尸运行", "重复内容", "critical");
        verify(alertLogService, never()).record(any(), any(), any(), anyString(),
                anyString(), anyString(), anyString(), anyString(), any());
    }
}