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
 * mis.recon.notify.mail.to；spring.mail.host 未配置 → 日志模拟成功（dev 期 mock）。
 */
@Slf4j
@Component
public class EmailReporter implements Reporter {

    private final JavaMailSender mailSender;
    private final String appDefaultTo;

    public EmailReporter(JavaMailSender mailSender,
                         @Value("${mis.recon.notify.mail.to:}") String appDefaultTo) {
        this.mailSender = mailSender;
        this.appDefaultTo = appDefaultTo;
    }

    @Override
    public String channel() {
        return "email";
    }

    @Override
    public SendResult send(ReportContent content) {
        String to = resolveTo(content);
        if (!StringUtils.hasText(to)) {
            log.info("[report][email] no recipient configured, mock send: title={}", content.getTitle());
            return SendResult.ok();
        }
        try {
            MimeMessage message = mailSender.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(message, true, "UTF-8");
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