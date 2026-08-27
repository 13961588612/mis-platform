package com.mis.recon.service.report;

import com.mis.recon.dao.ReportDao;
import com.mis.recon.dao.ReportDao.ReportRow;
import com.mis.recon.domain.config.ReconReporterConfig;
import com.mis.recon.domain.config.ReconScenario;
import com.mis.recon.domain.dto.ReportTriggerResp;
import com.mis.recon.repository.ScenarioRepository;
import com.mis.recon.service.alert.AlertLogService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentMatchers;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionStatus;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 报告引擎单测（T07-spec §3.1，验收 1/2）：扫描→渲染→发送→回填 + 指纹去重 + 发送失败留痕。
 */
class ReportRunnerTest {

    private ReportDao reportDao;
    private AlertLogService alertLogService;
    private ReporterFactory reporterFactory;
    private ReporterService reporterService;
    private ScenarioRepository scenarioRepository;
    private ReportRunner runner;

    private ReconScenario scenario;

    @BeforeEach
    void setUp() {
        reportDao = mock(ReportDao.class);
        alertLogService = mock(AlertLogService.class);
        reporterFactory = mock(ReporterFactory.class);
        reporterService = mock(ReporterService.class);
        scenarioRepository = mock(ScenarioRepository.class);
        PlatformTransactionManager txManager = mock(PlatformTransactionManager.class);
        when(txManager.getTransaction(any())).thenReturn(mock(TransactionStatus.class));

        scenario = new ReconScenario();
        scenario.setScenarioCode("sc1");
        scenario.setName("线上订单");
        scenario.setReportType("diff");
        when(scenarioRepository.findByScenarioCode("sc1")).thenReturn(Optional.of(scenario));
        when(alertLogService.exists(anyString())).thenReturn(false);
        when(reportDao.insertReportRun("sc1", "diff")).thenReturn(11L);

        runner = new ReportRunner(reportDao, alertLogService, reporterFactory, reporterService,
                scenarioRepository, txManager);
    }

    private ReportRow row(long id, String check, long cent) {
        return new ReportRow(id, check, "order-" + id, "field_mismatch", "金额不一致",
                cent, null, LocalDateTime.now().minusDays(1));
    }

    private Reporter okReporter() {
        return new Reporter() {
            @Override
            public String channel() {
                return "email";
            }

            @Override
            public SendResult send(ReportContent content) {
                return SendResult.ok();
            }
        };
    }

    @Test
    void emptyScanWritesSuccessRun() {
        when(reportDao.scanForReport("sc1")).thenReturn(List.of());

        ReportTriggerResp resp = runner.run("sc1");

        assertEquals(0, resp.getDiffCount());
        assertEquals("success", resp.getSendStatus());
        verify(reportDao).finishReportRun(11L, "success", 0, null);
        verify(reporterFactory, never()).get(any());
    }

    @Test
    void singleGroupSendsAndMarksReported() {
        when(reportDao.scanForReport("sc1")).thenReturn(List.of(row(1, "order_check", 100L)));
        when(reporterService.resolve(eq("sc1"), eq("order_check"))).thenReturn(null);
        when(reporterFactory.get(any())).thenReturn(okReporter());
        when(alertLogService.fingerprint(anyString(), anyString(), anyList(), anyString())).thenReturn("fp1");

        ReportTriggerResp resp = runner.run("sc1");

        assertEquals(1, resp.getDiffCount());
        assertEquals("success", resp.getSendStatus());
        verify(reporterFactory).get(null);
        verify(alertLogService).record(eq("sc1"), eq("order_check"), anyList(), eq("info"),
                eq(null), eq("fp1"), anyString(), eq("success"), eq(null));
        verify(reportDao).markReported(List.of(1L));
        verify(reportDao).finishReportRun(11L, "success", 1, null);
    }

    @Test
    void fingerprintDupSkipsSend() {
        when(reportDao.scanForReport("sc1")).thenReturn(List.of(row(1, "order_check", 100L)));
        when(reporterService.resolve(eq("sc1"), eq("order_check"))).thenReturn(null);
        when(alertLogService.fingerprint(anyString(), anyString(), anyList(), anyString())).thenReturn("fp1");
        when(alertLogService.exists(anyString())).thenReturn(true);

        ReportTriggerResp resp = runner.run("sc1");

        assertEquals("success", resp.getSendStatus());
        verify(reporterFactory, never()).get(ArgumentMatchers.any());
        verify(reportDao, never()).markReported(anyList());
    }

    @Test
    void sendFailureWritesFailedAlert() {
        when(reportDao.scanForReport("sc1")).thenReturn(List.of(row(1, "order_check", 100L)));
        when(reporterService.resolve(eq("sc1"), eq("order_check"))).thenReturn(null);
        when(alertLogService.fingerprint(anyString(), anyString(), anyList(), anyString())).thenReturn("fp1");
        when(reporterFactory.get(any())).thenReturn(new Reporter() {
            @Override
            public String channel() {
                return "email";
            }

            @Override
            public SendResult send(ReportContent content) {
                return SendResult.fail("smtp down");
            }
        });

        ReportTriggerResp resp = runner.run("sc1");

        assertEquals("failed", resp.getSendStatus());
        verify(alertLogService).record(eq("sc1"), eq("order_check"), anyList(), eq("info"),
                eq(null), eq("fp1"), anyString(), eq("failed"), eq("smtp down"));
        verify(reportDao, never()).markReported(anyList());
    }

    @Test
    void belowMinSeveritySkipsSend() {
        when(reportDao.scanForReport("sc1")).thenReturn(List.of(row(1, "order_check", 100L)));
        ReconReporterConfig route = new ReconReporterConfig();
        route.setMinSeverity("critical");
        route.setChannel("email");
        route.setConfigJson(null);
        when(reporterService.resolve(eq("sc1"), eq("order_check"))).thenReturn(route);

        ReportTriggerResp resp = runner.run("sc1");

        assertEquals("success", resp.getSendStatus());
        verify(reporterFactory, never()).get(ArgumentMatchers.any());
        verify(reportDao, never()).markReported(anyList());
    }
}