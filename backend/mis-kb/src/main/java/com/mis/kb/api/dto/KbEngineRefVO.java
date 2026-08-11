package com.mis.kb.api.dto;

import java.time.Instant;

/**
 * 知识库的引擎引用视图（引擎删除策略 P0 / T03，Q4 有限暴露 dataset_id）。
 *
 * <p><b>这是一个破架构红线的对象。</b>仓库既有约定（F8）是「对外只认 MIS ID，
 * 绝不暴露 {@code engine_library_ref}」——{@link KbLibraryVO} 至今没有这个字段就是这个原因。
 * 但归档场景下运维必须拿着 dataset_id 去 RAGFlow 控制台手工善后，没有它整个归档流程
 * 落不了地。所以这里开一个<b>独立端点 + 独立权限码 + 强制审计</b>的窄口子：
 *
 * <ul>
 *   <li>权限码 {@code kb:library:engine-ref:view}（不复用 {@code kb:library:view}）；</li>
 *   <li>BFF 侧必须挂 {@code @OperLog}，谁看过哪个库的 dataset_id 全部留痕；</li>
 *   <li><b>绝不</b>把该字段并回 {@code KbLibraryVO}——列表接口一旦带上，等于全量泄露。</li>
 * </ul>
 *
 * @param libraryId        MIS 知识库 ID
 * @param engineType       引擎类型（{@code ragflow} / {@code noop} / {@code mock}）
 * @param engineLibraryRef 引擎侧 dataset 原生 ID；未绑定为 {@code null}
 * @param engineSyncStatus 引擎同步状态码，见 {@link com.mis.kb.domain.model.EngineSyncStatus}
 * @param engineCheckedAt  最近一次对账 / 同步时刻；从未对过账为 {@code null}
 */
public record KbEngineRefVO(
        Long libraryId,
        String engineType,
        String engineLibraryRef,
        Integer engineSyncStatus,
        Instant engineCheckedAt) {
}
