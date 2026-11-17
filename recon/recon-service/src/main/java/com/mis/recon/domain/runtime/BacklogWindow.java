package com.mis.recon.domain.runtime;

import java.time.LocalDateTime;

/**
 * 欠账窗口（T06-spec §5）：time_window check 被健康闸门 skip 时写入的窗口记录，下轮先补算。
 */
public class BacklogWindow {

    private final long id;
    private final String scenarioCode;
    private final String checkName;
    private final LocalDateTime windowStart;
    private final LocalDateTime windowEnd;
    private final LocalDateTime resolvedAt;

    public BacklogWindow(long id, String scenarioCode, String checkName,
                         LocalDateTime windowStart, LocalDateTime windowEnd, LocalDateTime resolvedAt) {
        this.id = id;
        this.scenarioCode = scenarioCode;
        this.checkName = checkName;
        this.windowStart = windowStart;
        this.windowEnd = windowEnd;
        this.resolvedAt = resolvedAt;
    }

    public long getId() {
        return id;
    }

    public String getScenarioCode() {
        return scenarioCode;
    }

    public String getCheckName() {
        return checkName;
    }

    public LocalDateTime getWindowStart() {
        return windowStart;
    }

    public LocalDateTime getWindowEnd() {
        return windowEnd;
    }

    public LocalDateTime getResolvedAt() {
        return resolvedAt;
    }
}
