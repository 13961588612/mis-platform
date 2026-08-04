package com.mis.kb.domain.model;

import java.util.List;

/**
 * 一次同义词扩展的完整结果（Wave D，输出侧）。
 *
 * <p><b>⛔ 红线（WD-06 / 设计文档 §7.3）：本对象只挂在
 * {@code RetrieveQueryResolver.Resolution} 上，只有命中测试链路读它。
 * 禁止进入 {@code RetrieveHitsVO} 或任何问答链路响应体</b> —— 那等于把扩展串暴露给
 * {@code mis-rag}，AC-03b 直接判死。{@code RetrieveHitsVoContractTest} 会对此做断言。
 *
 * <p><b>四态互斥且必有值</b>（{@link #STATUS_EXPANDED} / {@link #STATUS_NO_MATCH} /
 * {@link #STATUS_DISABLED_GLOBAL} / {@link #STATUS_DISABLED_REQUEST}）。
 * 其中两条硬约束来自 §7.3：
 * <ol>
 *   <li>{@code NO_MATCH} <b>必须显式返回</b>，不能返回 {@code null}、不能让前端不渲染卡片
 *       —— 不显示会被理解成「功能坏了」（PRD §5.2-1）；</li>
 *   <li>{@code DISABLED_GLOBAL} 与 {@code DISABLED_REQUEST} <b>绝不可合并</b>成一个
 *       {@code disabled}：前者要去改开关，后者只要取消勾选，管理员的后续动作完全不同。</li>
 * </ol>
 *
 * <p><b>{@code expandedQuery} 恒非空</b>：未扩展时它逐字符等于 {@code originalQuestion}。
 * 下游不需要写 null 判断，也就不会有人「顺手」回退到读别的字段。
 *
 * @param status            四态之一，见上
 * @param originalQuestion  用户原话（逐字符保留）
 * @param expandedQuery     实际送给检索引擎的查询串；未扩展时 == {@code originalQuestion}
 * @param hits              命中轨迹；非扩展态为空列表
 * @param droppedGroups     因超 {@code maxGroups} 或超字符预算被<b>整组丢弃</b>的组规范词
 * @param skippedShortTerms 因短于 {@code minTermLength} 而未参与匹配、但确实出现在问句中的词（WD-19）
 * @param totalMatchedGroups 扫描阶段命中的组总数（截断前）
 * @param usedGroups        实际并入查询串的组数（截断后）
 * @param truncated         是否发生过截断（丢组或字符级硬截，任一即置位）
 * @param engineNativeHint  Q9 运维声明式开关，前端<b>必须用 {@code === true}</b> 判定（§7.8）
 * @param budget            本次生效的预算快照，前端提示文案里的数字全部取自这里（Q5）
 */
public record SynonymExpansion(
        String status,
        String originalQuestion,
        String expandedQuery,
        List<SynonymHit> hits,
        List<String> droppedGroups,
        List<String> skippedShortTerms,
        int totalMatchedGroups,
        int usedGroups,
        boolean truncated,
        boolean engineNativeHint,
        SynonymBudget budget) {

    /** 正常扩展且有命中：前端绿色徽标「已扩展 N 组」。 */
    public static final String STATUS_EXPANDED = "EXPANDED";
    /** 词典可用但零命中：前端灰色徽标「未命中术语」，<b>必须显式显示</b>。 */
    public static final String STATUS_NO_MATCH = "NO_MATCH";
    /** Nacos 熔断闸或库内开关为关：前端黄色徽标「同义词已全局关闭」+ 引导去 S-07。 */
    public static final String STATUS_DISABLED_GLOBAL = "DISABLED_GLOBAL";
    /** 请求模式为 {@link SynonymMode#OFF_THIS_RUN}：前端蓝色徽标「本次已关闭」。 */
    public static final String STATUS_DISABLED_REQUEST = "DISABLED_REQUEST";

    /** 紧凑构造：冻结列表、兜底空值，保证 {@code expandedQuery} 与 {@code budget} 恒非空。 */
    public SynonymExpansion {
        originalQuestion = originalQuestion == null ? "" : originalQuestion;
        expandedQuery = expandedQuery == null ? originalQuestion : expandedQuery;
        status = status == null ? STATUS_NO_MATCH : status;
        hits = hits == null ? List.of() : List.copyOf(hits);
        droppedGroups = droppedGroups == null ? List.of() : List.copyOf(droppedGroups);
        skippedShortTerms = skippedShortTerms == null ? List.of() : List.copyOf(skippedShortTerms);
        budget = budget == null ? SynonymBudget.defaults() : budget;
    }

    /**
     * 构造「未启用」结果（全局关或本次关）。
     *
     * <p>{@code expandedQuery} 逐字符等于 {@code question} —— 这是 AC-02 的基础断言。
     *
     * <p><b>与类图的差异（有意，已记录）：</b>类图签名是 {@code disabled(String, String)}，
     * 这里多了 {@code budget} 与 {@code engineNativeHint} 两个入参。原因：PRD §7 要求
     * 未启用态的徽标旁仍要显示当前预算数字（Q5「数字不许前端写死」），若工厂方法不接收预算，
     * 就只能在 record 里塞一个静态默认值，那等于把 Nacos 配置架空。
     *
     * @param status   {@link #STATUS_DISABLED_GLOBAL} 或 {@link #STATUS_DISABLED_REQUEST}
     * @param question 用户原话
     * @param budget   当前预算快照（前端仍需展示预算数字，故不能省）
     * @param engineNativeHint 引擎原生词表提示位
     * @return 未启用态的扩展结果
     */
    public static SynonymExpansion disabled(
            String status, String question, SynonymBudget budget, boolean engineNativeHint) {
        String q = question == null ? "" : question;
        return new SynonymExpansion(
                status, q, q,
                List.of(), List.of(), List.of(),
                0, 0, false, engineNativeHint, budget);
    }

    /**
     * 构造「零命中」结果。
     *
     * @param question          用户原话
     * @param budget            当前预算快照
     * @param skippedShortTerms 出现在问句中但因过短被跳过的词（可为空列表）
     * @param engineNativeHint  引擎原生词表提示位
     * @return {@link #STATUS_NO_MATCH} 态的扩展结果
     */
    public static SynonymExpansion noMatch(
            String question,
            SynonymBudget budget,
            List<String> skippedShortTerms,
            boolean engineNativeHint) {
        String q = question == null ? "" : question;
        return new SynonymExpansion(
                STATUS_NO_MATCH, q, q,
                List.of(), List.of(), skippedShortTerms,
                0, 0, false, engineNativeHint, budget);
    }

    /**
     * 是否真的发生了扩展。
     *
     * @return {@code status == EXPANDED} 返回 {@code true}
     */
    public boolean expanded() {
        return STATUS_EXPANDED.equals(status);
    }
}
