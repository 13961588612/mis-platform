package com.mis.kb.domain.model;

import java.util.List;

/**
 * 导入计划全文（Wave D · T08），序列化后落在 {@code kb_synonym_import_batch.plan_json}。
 *
 * <p><b>为什么计划必须落库而不是放内存 Map：</b>预检可能落在实例 A、提交落在实例 B
 * （{@code KbWebClient} 是 {@code @LoadBalanced}）。内存态在多实例下必然出现
 * 「预检明明成功了，提交却说 token 不存在」——与 {@code dict_version} 是同一个根因，
 * 也用同一个解法：<b>状态一律进库</b>。
 *
 * <p>{@link #version} 是<b>计划结构自身</b>的版本，与词表的 {@code dict_version} 是两回事，
 * 不要混。它的作用是：将来若给计划行加了字段，老实例读到新计划时能据此判断要不要拒绝。
 *
 * @param version 计划结构版本，当前固定 {@link #CURRENT_VERSION}
 * @param format  原始文件格式（{@code CSV} / {@code JSON}），决定未导入行按什么格式回吐
 * @param rows    行级计划，顺序与原始文件一致
 */
public record SynonymImportPlan(
        Integer version,
        String format,
        List<SynonymImportPlanRow> rows) {

    /** 当前计划结构版本。 */
    public static final int CURRENT_VERSION = 1;

    /**
     * 紧凑构造：补默认版本号、收敛行列表。
     */
    public SynonymImportPlan {
        version = version == null ? CURRENT_VERSION : version;
        rows = rows == null ? List.of() : List.copyOf(rows);
    }

    /**
     * 以当前版本号构造。
     *
     * @param format 文件格式
     * @param rows   行级计划
     * @return 计划
     */
    public static SynonymImportPlan of(String format, List<SynonymImportPlanRow> rows) {
        return new SynonymImportPlan(CURRENT_VERSION, format, rows);
    }

    /**
     * 按动作统计行数。
     *
     * @param action 动作码
     * @return 命中行数
     */
    public int count(String action) {
        int n = 0;
        for (SynonymImportPlanRow row : rows) {
            if (row.action() != null && row.action().equals(action)) {
                n++;
            }
        }
        return n;
    }
}
