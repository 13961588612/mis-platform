package com.mis.kb.domain.model;

/**
 * 解析状态快照（引擎回写载体，KE-03/KE-04）。
 *
 * <p>由 {@code KnowledgeEnginePort.queryDocumentParseStatuses} 返回，替代原先
 * {@code Map<String,String>}（仅状态）——新增 {@code progress}（0~100）与
 * {@code error}（引擎 progress_msg 摘要）。{@code KbDocumentService.syncOpenParseStatuses}
 * 据此批量回写 {@code kb_document.parse_status / parse_progress / parse_error}。
 *
 * <p><b>parse_error 口径（设计 §8）：</b>仅存引擎 {@code progress_msg} 摘要，
 * ≤500 字符，不存内部堆栈；成功/重试时清空。截断在紧凑构造器统一执行，
 * 任何构造点都不会超长。
 *
 * @param status   解析状态码值（见 {@link ParseStatus}）
 * @param progress 解析进度百分比 0~100；{@code null} = 未知
 * @param error    失败原因摘要（≤500 字符）；{@code null} = 无失败/未提供
 */
public record ParseStatusSnapshot(String status, Integer progress, String error) {

    /** parse_error 最大长度（与 {@code kb_document.parse_error TEXT} 存储口径对齐）。 */
    public static final int MAX_ERROR_LENGTH = 500;

    /**
     * 紧凑构造：error 统一截断 ≤{@value #MAX_ERROR_LENGTH} 字符，杜绝超长入库。
     *
     * @param status   解析状态码值，可为 {@code null}
     * @param progress 解析进度百分比 0~100，可为 {@code null}
     * @param error    失败原因摘要，可为 {@code null}
     */
    public ParseStatusSnapshot {
        progress = normalizeProgress(progress);
        error = normalizeError(error);
    }

    /**
     * 归一化进度：越界/非法一律回落 {@code null}（未知），不写入脏值。
     *
     * @param progress 原始进度
     * @return 0~100 区间内的整数；否则 {@code null}
     */
    public static Integer normalizeProgress(Integer progress) {
        if (progress == null) {
            return null;
        }
        int value = progress;
        if (value < 0 || value > 100) {
            return null;
        }
        return value;
    }

    /**
     * 归一化失败原因：空白 → {@code null}；超长截断至 {@value #MAX_ERROR_LENGTH} 字符。
     *
     * @param error 原始错误摘要
     * @return 归一化后的摘要；空白返回 {@code null}
     */
    public static String normalizeError(String error) {
        if (error == null || error.isBlank()) {
            return null;
        }
        String trimmed = error.trim();
        if (trimmed.length() <= MAX_ERROR_LENGTH) {
            return trimmed;
        }
        return trimmed.substring(0, MAX_ERROR_LENGTH);
    }

    /**
     * 状态是否有效（对齐 {@link ParseStatus#isValid()} 语义）。
     *
     * @return 状态码值合法返回 {@code true}
     */
    public boolean hasValidStatus() {
        return ParseStatus.isValid(status);
    }
}
