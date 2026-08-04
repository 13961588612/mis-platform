package com.mis.adminbff.dto.kb;

import java.time.Instant;
import java.util.List;

/**
 * 术语组视图（BFF 侧镜像，字段与 mis-kb {@code SynonymGroupVO} 一一对齐）。
 *
 * <p>Wave D 新增。本层<b>纯透传、零加工</b>：不补 {@code terms}、不算 {@code termCount}、
 * 不改写 {@code matchedAlias}。列表接口返回的 {@code terms} 恒为 {@code null} 是
 * mis-kb 的<b>刻意设计</b>（一页 20 组各带全量词条会把响应体撑大一个数量级），
 * BFF 若「顺手」补齐，等于把那条性能约束在这一层悄悄废掉。
 *
 * @param id            术语组 ID
 * @param canonicalTerm 规范词原文
 * @param remark        备注
 * @param status        1=启用 0=停用；<b>停用仍占用词条唯一性</b>（Q3）
 * @param terms         组内词条（详情场景回填，列表场景为 {@code null}）
 * @param termCount     组内词条总数（含规范词）
 * @param matchedAlias  服务端搜索命中别名时回填，供列表展示「命中别名：X」
 * @param updatedAt     最后更新时间
 * @param updatedBy     最后更新人
 */
public record KbSynonymGroupVO(
        Long id,
        String canonicalTerm,
        String remark,
        Integer status,
        List<KbSynonymTermItemVO> terms,
        Integer termCount,
        String matchedAlias,
        Instant updatedAt,
        Long updatedBy) {

    /**
     * 组内单个词条（BFF 镜像）。
     *
     * <p>{@code term} 是<b>原文</b>而非 {@code term_norm}：判重在归一化词形上做，
     * 展示一律用用户实际写下的那个写法。
     *
     * @param term      词条原文
     * @param canonical 是否为本组规范词
     * @param sortNo    组内排序号；规范词恒为 0
     */
    public record KbSynonymTermItemVO(
            String term,
            Boolean canonical,
            Integer sortNo) {
    }
}
