package com.mis.recon.domain.enums;

import com.mis.recon.common.BizException;
import com.mis.recon.common.ErrorCode;

/**
 * 结果类枚举（F26）：常量名即 DDL 落库值（code=name，G18）。
 */
public final class ResultEnums {

    private ResultEnums() {
    }

    /** 差异类型 */
    public enum DiffType {
        field_mismatch, unmatched_left, unmatched_right, anomaly;

        public static DiffType from(String value) {
            return parse(DiffType.class, value, "field_mismatch/unmatched_left/unmatched_right/anomaly");
        }

        public String code() {
            return name();
        }
    }

    /** 差异状态（可流转） */
    public enum DiffStatus {
        pending, confirmed, resolved, deferred;

        public static DiffStatus from(String value) {
            return parse(DiffStatus.class, value, "pending/confirmed/resolved/deferred");
        }

        public String code() {
            return name();
        }
    }

    /** 人工处理状态（引擎不覆盖） */
    public enum HandleStatus {
        unhandled, handled, ignored, false_positive;

        public static HandleStatus from(String value) {
            return parse(HandleStatus.class, value, "unhandled/handled/ignored/false_positive");
        }

        public String code() {
            return name();
        }
    }

    /** 健康状态 */
    public enum HealthStatus {
        healthy, degraded, empty, error;

        public static HealthStatus from(String value) {
            return parse(HealthStatus.class, value, "healthy/degraded/empty/error");
        }

        public String code() {
            return name();
        }
    }

    /** 运行状态（T05 引入 partial_success，T03 预置无冲突） */
    public enum RunStatus {
        running, success, partial_success, failed, skipped;

        public static RunStatus from(String value) {
            return parse(RunStatus.class, value, "running/success/partial_success/failed/skipped");
        }

        public String code() {
            return name();
        }
    }

    /** 发送状态 */
    public enum SendStatus {
        success, failed, partial;

        public static SendStatus from(String value) {
            return parse(SendStatus.class, value, "success/failed/partial");
        }

        public String code() {
            return name();
        }
    }

    /** 告警级别 */
    public enum Severity {
        info, warn, critical;

        public static Severity from(String value) {
            return parse(Severity.class, value, "info/warn/critical");
        }

        public String code() {
            return name();
        }
    }

    /** 报告类型 */
    public enum ReportType {
        diff, balance, both;

        public static ReportType from(String value) {
            return parse(ReportType.class, value, "diff/balance/both");
        }

        public String code() {
            return name();
        }
    }

    private static <E extends Enum<E>> E parse(Class<E> type, String value, String legal) {
        if (value == null) {
            throw new BizException(ErrorCode.INVALID_ENUM_VALUE, type.getSimpleName() + " 不能为空");
        }
        try {
            return Enum.valueOf(type, value.trim());
        } catch (IllegalArgumentException e) {
            throw new BizException(ErrorCode.INVALID_ENUM_VALUE, type.getSimpleName() + " 非法: " + value + "，合法值: " + legal);
        }
    }
}
