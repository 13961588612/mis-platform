package com.mis.recon.service.report;

import org.junit.jupiter.api.Test;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.web.client.RestClient;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;

/**
 * P0-2「报告/告警渠道静默 mock 成功」整改单测：
 * 渠道未配置（邮件收件人 / webhook url 为空）时，默认（mock-enabled=false）显式失败；
 * 仅显式开启 mock-enabled=true 才 mock 成功。防生产"假成功"导致平衡表/告警审计证据链断裂。
 */
class ReporterMockGateTest {

    private static ReportContent content() {
        return new ReportContent("sc1", "c1", "t", "b", "info").withConfig(null);
    }

    @Test
    void emailUnconfiguredFailsByDefault() {
        EmailReporter reporter = new EmailReporter(mock(JavaMailSender.class), "", false, "");
        SendResult result = reporter.send(content());
        assertFalse(result.isSuccess());
        assertTrue(result.getError().contains("no recipient"));
    }

    @Test
    void emailUnconfiguredMocksOnlyWhenEnabled() {
        EmailReporter reporter = new EmailReporter(mock(JavaMailSender.class), "", true, "");
        assertTrue(reporter.send(content()).isSuccess());
    }

    @Test
    void emailNoSenderFailsByDefaultEvenWithRecipient() {
        EmailReporter reporter = new EmailReporter(mock(JavaMailSender.class), "ops@example.com", false, "");
        SendResult result = reporter.send(content());
        assertFalse(result.isSuccess());
        assertTrue(result.getError().contains("no sender"));
    }

    @Test
    void webhookUnconfiguredFailsByDefault() {
        WebhookReporter reporter = new WebhookReporter(mock(RestClient.Builder.class), "", false);
        SendResult result = reporter.send(content());
        assertFalse(result.isSuccess());
        assertTrue(result.getError().contains("no url"));
    }

    @Test
    void webhookUnconfiguredMocksOnlyWhenEnabled() {
        WebhookReporter reporter = new WebhookReporter(mock(RestClient.Builder.class), "", true);
        assertTrue(reporter.send(content()).isSuccess());
    }

    @Test
    void emailConfiguredToFromConfigSends() {
        JavaMailSender sender = mock(JavaMailSender.class);
        EmailReporter reporter = new EmailReporter(sender, "", false, "ops@example.com");
        ReportContent content = content().withConfig("{\"to\":\"ops@example.com\"}");
        // 未 mock sender.send，实际 send 抛 NPE → 走 fail 分支；断言不因"未配置"失败即可证明走发送路径
        SendResult result = reporter.send(content);
        assertFalse(result.getError().contains("no recipient"));
        assertFalse(result.getError().contains("no sender"));
    }

    @Test
    void webhookConfiguredUrlFromConfigSends() {
        WebhookReporter reporter = new WebhookReporter(mock(RestClient.Builder.class), "", false);
        ReportContent content = content().withConfig("{\"url\":\"http://hook.local/x\"}");
        SendResult result = reporter.send(content);
        assertFalse(result.getError().contains("no url"));
    }
}
