package com.mis.recon.service.report;

import com.fasterxml.jackson.databind.JsonNode;
import com.mis.recon.util.JsonUtil;
import jakarta.mail.internet.MimeMessage;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

/**
 * 邮件渠道（F100，T07-spec §3.3）：收件人取 content.configJson.to，未配置降级应用级
 * mis.recon.notify.mail.to。
 * <p>P0-2：渠道未配置时不再静默 mock 成功——仅当显式开启
 * {@code mis.recon.notify.mock-enabled=true}（本地开发）才 mock；默认 false 时
 * 返回显式失败（报告任务记 failed + 告警），避免生产平衡表/告警"假成功"导致审计证据链断裂。</p>
 */
@Slf4j
@Component
public class EmailReporter implements Reporter {

    private final JavaMailSender mailSender;
    private final String appDefaultTo;
    private final boolean mockEnabled;
    private final String from;

    public EmailReporter(JavaMailSender mailSender,
                         @Value("${mis.recon.notify.mail.to:}") String appDefaultTo,
                         @Value("${mis.recon.notify.mock-enabled:false}") boolean mockEnabled,
                         @Value("${spring.mail.properties.mail.from:}") String from) {
        this.mailSender = mailSender;
        this.appDefaultTo = appDefaultTo;
        this.mockEnabled = mockEnabled;
        this.from = from;
    }

    @Override
    public String channel() {
        return "email";
    }

    @Override
    public SendResult send(ReportContent content) {
        String to = resolveTo(content);
        if (!StringUtils.hasText(to) || !StringUtils.hasText(from)) {
            if (mockEnabled) {
                log.info("[report][email] no recipient/sender configured, mock send: title={}", content.getTitle());
                return SendResult.ok();
            }
            String missing = !StringUtils.hasText(to)
                    ? "no recipient (set mis.recon.notify.mail.to or reporter config to)"
                    : "no sender (set spring.mail.properties.mail.from / MAIL_FROM)";
            return SendResult.fail("email channel not configured: " + missing);
        }
        try {
            MimeMessage message = mailSender.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(message, true, "UTF-8");
            helper.setFrom(from);
            helper.setTo(to);
            helper.setSubject(content.getTitle());
            helper.setText(content.getBody());
            mailSender.send(message);
            log.info("[report][email] sent to={} title={}", to, content.getTitle());
            return SendResult.ok();
        } catch (Exception e) {
            log.warn("[report][email] send failed to={}: {}", to, e.getMessage());
            return SendResult.fail(e.getMessage());
        }
    }

    private String resolveTo(ReportContent content) {
        String cfg = content.getConfigJson();
        if (StringUtils.hasText(cfg)) {
            JsonNode node = JsonUtil.parse(cfg);
            if (node != null && node.hasNonNull("to") && node.get("to").isTextual()) {
                String to = node.get("to").asText();
                if (StringUtils.hasText(to)) {
                    return to;
                }
            }
        }
        return appDefaultTo;
    }
}