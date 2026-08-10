package com.mis.kb.engine;

import com.mis.kb.domain.model.ParseStatus;

/**
 * RAGFlow 文档 {@code run}/{@code progress} → MIS {@link ParseStatus} 码值。
 *
 * <p>RAGFlow 不同版本可能返回字符串（{@code DONE}/{@code RUNNING}）或数字码
 * （{@code 0}/{@code 1}/{@code 3}），二者均兼容。
 */
public final class RagflowParseStatusMapper {

    private RagflowParseStatusMapper() {
    }

    /**
     * @param run      RAGFlow {@code run} 字段，可为 null
     * @param progress RAGFlow {@code progress}（0~1），可为 null
     * @return MIS parse_status 码；无法判定时返回 {@code null}（调用方保留原值）
     */
    public static String toParseStatus(String run, Double progress) {
        if (run != null && !run.isBlank()) {
            String r = run.trim().toUpperCase();
            return switch (r) {
                case "DONE", "3" -> ParseStatus.SUCCESS.code();
                case "FAIL", "FAILED", "4" -> ParseStatus.FAILED.code();
                case "CANCEL", "CANCELLED", "CANCELED", "2" -> ParseStatus.FAILED.code();
                case "RUNNING", "1" -> ParseStatus.PARSING.code();
                case "UNSTART", "0" -> ParseStatus.PENDING.code();
                default -> fromProgress(progress);
            };
        }
        return fromProgress(progress);
    }

    private static String fromProgress(Double progress) {
        if (progress == null) {
            return null;
        }
        if (progress >= 1.0D) {
            return ParseStatus.SUCCESS.code();
        }
        if (progress > 0.0D) {
            return ParseStatus.PARSING.code();
        }
        return ParseStatus.PENDING.code();
    }
}
