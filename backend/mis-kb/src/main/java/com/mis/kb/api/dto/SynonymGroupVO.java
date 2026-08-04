package com.mis.kb.api.dto;

import com.mis.kb.domain.entity.KbSynonymGroup;
import com.mis.kb.domain.entity.KbSynonymTerm;

import java.time.Instant;
import java.util.List;

/**
 * 术语组视图（Wave D，WD-02 / WD-03）。
 *
 * <p>字段与前端 {@code KbSynonymGroup}（{@code features/kb/types.ts}）<b>逐字段对齐</b>，
 * BFF 侧 {@code KbSynonymGroupVO} 是本类的镜像，纯透传不做加工。
 *
 * <p><b>{@link #terms} 的顺序即语义</b>：{@code sortNo} 升序，规范词恒在首位
 * （{@code canonical=1, sortNo=0}），别名从 1 递增。这个顺序在预算截断时决定谁先入选，
 * 因此列表接口也必须按同一顺序返回——前端拖拽调序后原样回传，顺序就是用户的意图表达。
 *
 * <p><b>{@link #terms} 在列表场景刻意为 {@code null}</b>：分页列表一次可能返回 20 组，
 * 每组再带全量词条会把响应体撑大一个数量级，而列表只需要 {@link #termCount} 做「共 N 个词条」
 * 的展示。详情接口才回填完整 {@link #terms}。前端类型也据此写成 {@code terms: ... | null}。
 *
 * @param id            术语组 ID
 * @param canonicalTerm 规范词原文
 * @param remark        备注
 * @param status        1=启用 0=停用；<b>停用仍占用词条唯一性</b>（Q3）
 * @param terms         组内词条（详情场景回填，列表场景为 {@code null}）
 * @param termCount     组内词条总数（含规范词）
 * @param matchedAlias  服务端搜索命中的是别名时回填，供列表高亮「命中别名：X」；否则 {@code null}
 * @param updatedAt     最后更新时间
 * @param updatedBy     最后更新人
 */
public record SynonymGroupVO(
        Long id,
        String canonicalTerm,
        String remark,
        Integer status,
        List<SynonymTermItemVO> terms,
        Integer termCount,
        String matchedAlias,
        Instant updatedAt,
        Long updatedBy) {

    /**
     * 组内单个词条视图。
     *
     * @param term      词条原文（<b>不是</b> {@code term_norm}，展示一律用原文）
     * @param canonical 是否为本组规范词
     * @param sortNo    组内排序号；规范词恒为 0
     */
    public record SynonymTermItemVO(
            String term,
            Boolean canonical,
            Integer sortNo) {

        /**
         * 由实体构造视图。
         *
         * @param entity 词条实体；{@code null} 时返回 {@code null}
         * @return 视图对象
         */
        public static SynonymTermItemVO from(KbSynonymTerm entity) {
            if (entity == null) {
                return null;
            }
            return new SynonymTermItemVO(
                    entity.getTerm(), entity.isCanonical(), entity.getSortNo());
        }
    }

    /**
     * 列表视图（不带 {@link #terms}，只带计数）。
     *
     * @param group        组实体
     * @param termCount    组内词条总数
     * @param matchedAlias 命中的别名；无则传 {@code null}
     * @return 视图对象
     */
    public static SynonymGroupVO ofSummary(
            KbSynonymGroup group, int termCount, String matchedAlias) {
        if (group == null) {
            return null;
        }
        return new SynonymGroupVO(
                group.getId(),
                group.getCanonicalTerm(),
                group.getRemark(),
                group.getStatus(),
                null,
                termCount,
                matchedAlias,
                group.getUpdatedAt(),
                group.getUpdatedBy());
    }

    /**
     * 详情视图（回填完整 {@link #terms}）。
     *
     * @param group 组实体
     * @param terms 组内词条，需已按 {@code sortNo} 升序
     * @return 视图对象
     */
    public static SynonymGroupVO ofDetail(KbSynonymGroup group, List<KbSynonymTerm> terms) {
        if (group == null) {
            return null;
        }
        List<SynonymTermItemVO> items = terms == null
                ? List.of()
                : terms.stream().map(SynonymTermItemVO::from).toList();
        return new SynonymGroupVO(
                group.getId(),
                group.getCanonicalTerm(),
                group.getRemark(),
                group.getStatus(),
                items,
                items.size(),
                null,
                group.getUpdatedAt(),
                group.getUpdatedBy());
    }
}
