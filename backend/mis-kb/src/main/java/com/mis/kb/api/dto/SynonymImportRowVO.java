package com.mis.kb.api.dto;

import com.mis.kb.domain.model.SynonymImportPlanRow;

/**
 * 导入预检的<b>逐行明细</b>（Wave D，WD-04）。
 *
 * <p>字段与前端 {@code KbSynonymImportRow}（{@code features/kb/types.ts}）逐字段对齐。
 *
 * <p><b>后四个字段是 PRD §4.4.4 第 2 条前置条件的全部数据基础</b>：
 * 报告里那句「第 27 行「OKR」已属于术语组「关键结果法」」由
 * {@link #lineNo} + {@link #conflictTerm} + {@link #ownerCanonicalTerm} 三样拼出，
 * 缺一样前端就只能显示一句无信息量的「有冲突」。{@link #ownerGroupId} 则支撑
 * 「点击跳到那个组」的交互。
 *
 * <p><b>{@link #conflictTerm} 一律是原文</b>：判重在 {@code term_norm} 上做，
 * 但回显给用户的必须是他在文件里实际写的那个写法，否则「我文件里写的是 ＯＫＲ，
 * 你报错说 okr 冲突」会让人怀疑是不是报错报错了行。
 *
 * @param lineNo             原始文件行号（1 起）
 * @param canonicalTerm      本行规范词原文
 * @param action             {@code CREATE} / {@code MERGE} / {@code SKIP}
 * @param skipReason         跳过原因（仅 SKIP 行非空）
 * @param conflictTerm       冲突词原文（仅冲突类 SKIP 行非空）
 * @param ownerGroupId       冲突词现属组 ID（仅冲突类 SKIP 行非空）
 * @param ownerCanonicalTerm 冲突词现属组规范词（仅冲突类 SKIP 行非空）
 */
public record SynonymImportRowVO(
        Integer lineNo,
        String canonicalTerm,
        String action,
        String skipReason,
        String conflictTerm,
        Long ownerGroupId,
        String ownerCanonicalTerm) {

    /**
     * 由计划行投影为展示视图。
     *
     * <p>刻意<b>不</b>带 {@code aliases} / {@code targetGroupId}：前者会让 2000 行的报告
     * 响应体膨胀数倍，后者是执行细节，前端不需要也不该依赖。
     *
     * @param row 计划行；{@code null} 时返回 {@code null}
     * @return 展示视图
     */
    public static SynonymImportRowVO from(SynonymImportPlanRow row) {
        if (row == null) {
            return null;
        }
        return new SynonymImportRowVO(
                row.lineNo(),
                row.canonicalTerm(),
                row.action(),
                row.skipReason(),
                row.conflictTerm(),
                row.ownerGroupId(),
                row.ownerCanonicalTerm());
    }
}
