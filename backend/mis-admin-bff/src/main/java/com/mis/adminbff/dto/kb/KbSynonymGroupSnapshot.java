package com.mis.adminbff.dto.kb;

import java.util.List;

/**
 * 术语组「删除前快照」（Wave D，设计 §7.7 的硬删可追溯要求）。
 *
 * <p><b>为什么需要一个独立的窄类型，而不是直接把 {@link KbSynonymGroupVO} 交给审计切面：</b>
 * {@code OperLogAspect} 用的是一个<b>裸 {@code new ObjectMapper()}</b>（该类有注释说明
 * 这是刻意为之：审计序列化不应随对外 API 契约漂移）。裸实例没有注册 JavaTimeModule，
 * 遇到 {@code KbSynonymGroupVO.updatedAt} 这个 {@code Instant} 会直接抛
 * {@code InvalidDefinitionException}；而切面的 {@code collectParams} 对异常是<b>整体吞掉
 * 并返回 null</b>——结果不是「少记一个时间字段」，而是<b>整条 requestParams 变成空</b>，
 * 连组 ID 都留不下。审计的失败方式恰恰是「静默地什么都没记」，比报错更危险。
 *
 * <p>因此本记录<b>只用 Jackson 免注册即可序列化的类型</b>（{@code Long} / {@code String} /
 * {@code Integer} / {@code List<String>}），不含任何 {@code java.time} 字段。
 * 新增字段时请守住这条线。
 *
 * <p><b>为什么快照必须落审计而不是只写应用日志：</b>Q4 裁决删除为硬删，词条随组级联消失。
 * 应用日志按天滚动、按容量清理，而 {@code sys_oper_log} 是长保留、可检索、可导出给合规的
 * 那一份。「三个月前谁把『OKR』那组删了、里面原本有哪些别名」只有落在审计表里才答得上来。
 *
 * @param id            组 ID
 * @param canonicalTerm 规范词原文
 * @param status        删除时的状态：1=启用 0=停用
 * @param remark        备注
 * @param terms         删除时组内全部词条<b>原文</b>（含规范词），顺序即 {@code sortNo} 升序。
 *                      这是硬删后唯一能还原「这组当时长什么样」的依据
 */
public record KbSynonymGroupSnapshot(
        Long id,
        String canonicalTerm,
        Integer status,
        String remark,
        List<String> terms) {

    /**
     * 从详情视图提取快照。
     *
     * <p>对 {@code null} 与缺失 {@code terms} 一律容忍——快照是<b>尽力而为</b>的追溯material：
     * 下游详情因为并发删除而取不到时，宁可记一条只有 ID 的残缺快照，
     * 也好过让审计整条丢失，更不能因此把删除操作本身弄失败。
     *
     * @param id     组 ID，作为 {@code detail} 为空时的兜底
     * @param detail 组详情；可为 {@code null}
     * @return 快照，恒非 {@code null}
     */
    public static KbSynonymGroupSnapshot from(Long id, KbSynonymGroupVO detail) {
        if (detail == null) {
            return new KbSynonymGroupSnapshot(id, null, null, null, List.of());
        }
        List<String> terms = detail.terms() == null
                ? List.of()
                : detail.terms().stream()
                        .map(KbSynonymGroupVO.KbSynonymTermItemVO::term)
                        .filter(term -> term != null && !term.isBlank())
                        .toList();
        return new KbSynonymGroupSnapshot(
                detail.id() != null ? detail.id() : id,
                detail.canonicalTerm(),
                detail.status(),
                detail.remark(),
                terms);
    }
}
