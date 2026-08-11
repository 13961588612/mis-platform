package com.mis.kb.domain.model;

/**
 * 游离 dataset 处置请求（P1-T3）。
 *
 * <p>三种动作共用一个请求体，只填各自需要的字段：
 * <ul>
 *   <li>{@code bind_existing}：必填 {@code targetLibraryId}；</li>
 *   <li>{@code adopt_new}：必填 {@code name} / {@code categoryId} / {@code secrecy}（{@code owner} 缺省取操作者）；</li>
 *   <li>{@code ignore}：必填 {@code note}（trim 后 ≥ 5 字）。</li>
 * </ul>
 *
 * @param action          处置动作码（{@link KbEngineOrphanAction#code()}）
 * @param note            ignore 动作的备注；bind/adopt 可附加说明
 * @param targetLibraryId bind_existing 的目标库 ID
 * @param name            adopt_new 的新库名
 * @param categoryId      adopt_new 的新库所属分类
 * @param secrecy         adopt_new 的新库密级
 * @param owner           adopt_new 的新库归属人（缺省取操作者）
 */
public record KbEngineOrphanResolveReq(
        String action,
        String note,
        Long targetLibraryId,
        String name,
        Long categoryId,
        String secrecy,
        Long owner) {
}
