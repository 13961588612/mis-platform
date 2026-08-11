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

    /**
     * RAGFlow {@code progress}（0~1）→ MIS 进度百分比（0~100）。
     *
     * <p>RAGFlow 的 progress 是 0~1 的小数（如 {@code 0.42}），而 MIS 侧
     * {@code kb_document.parse_progress} 存 0~100 的整数百分比，入库前必须换算。
     * 越界/非法一律回落 {@code null}（未知），不写入脏值——由
     * {@link ParseStatusSnapshot#normalizeProgress} 兜底二次校验。
     *
     * @param progress RAGFlow progress（0~1），可为 {@code null}
     * @return 0~100 的整数百分比；无法判定时返回 {@code null}
     */
    public static Integer toProgress(Double progress) {
        if (progress == null) {
            return null;
        }
        if (progress < 0.0D || progress > 1.0D) {
            return null;
        }
        return (int) Math.round(progress * 100.0D);
    }
}
