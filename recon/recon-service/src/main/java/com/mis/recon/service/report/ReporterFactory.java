package com.mis.recon.service.report;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 渠道分发（F102，T07-spec §3.3）：按 channel 取已注册 Reporter；非法/未注册渠道 → 返回降级 Mock。
 */
@Slf4j
@Component
public class ReporterFactory {

    private final Map<String, Reporter> reporters = new HashMap<>();

    public ReporterFactory(List<Reporter> reporters) {
        for (Reporter r : reporters) {
            this.reporters.put(r.channel(), r);
        }
    }

    /** 未注册渠道返回 Mock（日志降级，模拟成功，dev 期不中断主流程）。 */
    public Reporter get(String channel) {
        Reporter r = channel == null ? null : reporters.get(channel);
        if (r == null) {
            log.info("[report][factory] channel[{}] 未配置渠道，降级 mock", channel);
            return MOCK;
        }
        return r;
    }

    private static final Reporter MOCK = new Reporter() {
        @Override
        public String channel() {
            return "mock";
        }

        @Override
        public SendResult send(ReportContent content) {
            log.info("[report][mock] 模拟发送: title={}", content.getTitle());
            return SendResult.ok();
        }
    };
}