package com.mis.kb.domain.model;

import java.util.List;

/**
 * 导入计划中的<b>一行</b>（Wave D · T08），也是 {@code plan_json} 的最小存储单元。
 *
 * <p><b>一份数据，三处消费</b>（这也是它必须携带原始内容、而不能只存判定结果的原因）：
 * <ol>
 *   <li><b>预检报告</b>：投影成 {@code SynonymImportRowVO} 回给前端（只取展示字段）；</li>
 *   <li><b>提交执行</b>：严格照 {@link #action} 与 {@link #targetGroupId} 落库，
 *       <b>不重新判定</b>——预检报告承诺的「38/6/4」若在提交时被重算，回执数字就是假的
 *       （主理人 Q10 的直接推论）；</li>
 *   <li><b>下载未导入行</b>：把 {@code action == SKIP} 的行按原格式回吐，
 *       因此必须留着 {@link #canonicalTerm} / {@link #aliases} / {@link #remark} /
 *       {@link #status} 这四样原始内容，管理员改完能直接再传一次。</li>
 * </ol>
 *
 * <p>正因为第 3 点，<b>原始上传文件不必留存</b>——省一套对象存储的运维成本。
 *
 * @param lineNo             原始文件行号（1 起）
 * @param canonicalTerm      规范词原文
 * @param aliases            别名原文列表（保持文件内顺序）
 * @param remark             备注
 * @param status             1=启用 0=停用
 * @param action             {@link #ACTION_CREATE} / {@link #ACTION_MERGE} / {@link #ACTION_SKIP}
 * @param skipReason         跳过原因（仅 SKIP 行非空）；面向管理员的自然语言
 * @param conflictTerm       冲突词<b>原文</b>（不是归一化词形）；仅冲突类 SKIP 行非空
 * @param ownerGroupId       冲突词现属组 ID；仅冲突类 SKIP 行非空
 * @param ownerCanonicalTerm 冲突词现属组的规范词；仅冲突类 SKIP 行非空
 * @param targetGroupId      MERGE 行的目标组 ID；其余行为 {@code null}
 */
public record SynonymImportPlanRow(
        Integer lineNo,
        String canonicalTerm,
        List<String> aliases,
        String remark,
        Integer status,
        String action,
        String skipReason,
        String conflictTerm,
        Long ownerGroupId,
        String ownerCanonicalTerm,
        Long targetGroupId) {

    /** 新建术语组。 */
    public static final String ACTION_CREATE = "CREATE";
    /** 并入已有同名规范词的术语组。 */
    public static final String ACTION_MERGE = "MERGE";
    /** 跳过本行（其余行照常导入，PRD §4.4.4 的产品决策）。 */
    public static final String ACTION_SKIP = "SKIP";

    /**
     * 紧凑构造：{@code aliases} 收敛为不可变非空列表。
     *
     * <p>Jackson 反序列化 record 时走的也是这个构造器，所以从 {@code plan_json}
     * 读回来的行同样得到空值保护——{@code aliases} 为 {@code null} 的历史数据
     * 不会在提交阶段炸出 NPE。
     */
    public SynonymImportPlanRow {
        aliases = aliases == null ? List.of() : List.copyOf(aliases);
    }

    /**
     * 构造一条「跳过」计划行。
     *
     * @param source     解析出的原始组
     * @param reason     跳过原因（面向管理员）
     * @param conflict   冲突词原文；非冲突类跳过传 {@code null}
     * @param ownerId    现属组 ID；非冲突类跳过传 {@code null}
     * @param ownerTerm  现属组规范词；非冲突类跳过传 {@code null}
     * @return 计划行
     */
    public static SynonymImportPlanRow skip(
            SynonymParsedGroup source, String reason, String conflict, Long ownerId, String ownerTerm) {
        return new SynonymImportPlanRow(
                source.lineNo(),
                source.canonicalTerm(),
                source.aliases(),
                source.remark(),
                source.status(),
                ACTION_SKIP,
                reason,
                conflict,
                ownerId,
                ownerTerm,
                null);
    }

    /**
     * 构造一条「新建」计划行。
     *
     * @param source 解析出的原始组
     * @return 计划行
     */
    public static SynonymImportPlanRow create(SynonymParsedGroup source) {
        return new SynonymImportPlanRow(
                source.lineNo(),
                source.canonicalTerm(),
                source.aliases(),
                source.remark(),
                source.status(),
                ACTION_CREATE,
                null,
                null,
                null,
                null,
                null);
    }

    /**
     * 构造一条「并入」计划行。
     *
     * @param source        解析出的原始组
     * @param targetGroupId 目标组 ID（其规范词与本行规范词归一化后相等）
     * @return 计划行
     */
    public static SynonymImportPlanRow merge(SynonymParsedGroup source, Long targetGroupId) {
        return new SynonymImportPlanRow(
                source.lineNo(),
                source.canonicalTerm(),
                source.aliases(),
                source.remark(),
                source.status(),
                ACTION_MERGE,
                null,
                null,
                null,
                null,
                targetGroupId);
    }

    /**
     * 是否为跳过行。
     *
     * @return {@code action == SKIP} 返回 {@code true}
     */
    public boolean isSkip() {
        return ACTION_SKIP.equals(action);
    }

    /**
     * 是否为新建行。
     *
     * @return {@code action == CREATE} 返回 {@code true}
     */
    public boolean isCreate() {
        return ACTION_CREATE.equals(action);
    }

    /**
     * 是否为并入行。
     *
     * @return {@code action == MERGE} 返回 {@code true}
     */
    public boolean isMerge() {
        return ACTION_MERGE.equals(action);
    }

    /**
     * 折算回解析产物形态（回吐未导入行时给 Codec 用）。
     *
     * @return 等价的 {@link SynonymParsedGroup}
     */
    public SynonymParsedGroup toParsedGroup() {
        return new SynonymParsedGroup(
                lineNo == null ? 0 : lineNo, canonicalTerm, aliases, remark, status);
    }
}
