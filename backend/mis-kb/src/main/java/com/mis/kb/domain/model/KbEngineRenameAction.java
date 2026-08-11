package com.mis.kb.domain.model;

/**
 * 存量 dataset 重命名动作（P1-T4，写入 {@code kb_engine_rename_log.action}）。
 *
 * <p>与日志表取值一一对应。注意它和失败状态是两个维度：{@code action=RENAME}
 * 表示「这次本来要改名」，但 {@code status} 可能是 1（成功）或 2（失败）。
 */
public enum KbEngineRenameAction {

    /** 实际改名（期望名 ≠ 实际名）。 */
    RENAME("RENAME"),
    /** 名称已规范，无需改（幂等跳过）。 */
    SKIP("SKIP"),
    /** 引擎侧改名调用失败。 */
    FAILED("FAILED"),
    /** 回滚：把某批次的成功改名还原（new_name → old_name）。 */
    ROLLBACK("ROLLBACK");

    private final String code;

    KbEngineRenameAction(String code) {
        this.code = code;
    }

    /** 线上码值。 */
    public String code() {
        return code;
    }
}
