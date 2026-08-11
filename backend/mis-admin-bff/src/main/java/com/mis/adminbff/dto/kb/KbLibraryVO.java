package com.mis.adminbff.dto.kb;

import java.time.Instant;

/**
 * 知识库视图（BFF 侧镜像）。
 *
 * <p>只含 MIS 业务 ID，<b>不含引擎原生 id</b>；{@code docCount} 由下游聚合返回。
 * 需要 dataset_id 的场景走独立端点 {@link KbEngineRefVO}（带独立权限码 + 审计）。
 *
 * <p><b>T04 末位追加 5 个字段</b>，镜像 mis-kb 的同名 VO：
 * <ul>
 *   <li>{@code engineSyncStatus} / {@code engineCheckedAt}：列表页「引擎同步」徽标列的数据源；</li>
 *   <li>{@code archivedAt}：配合 {@code status==0} 区分「停用」与「归档」（前者可直接恢复，
 *       后者引擎侧已改名）；</li>
 *   <li>{@code engineSyncFailed} / {@code engineSyncMessage}：仅 {@code PUT /libraries/{id}}
 *       的回执会填，列表/详情恒 {@code null}。</li>
 * </ul>
 *
 * @param id                MIS 知识库 ID
 * @param categoryId        所属分类 ID
 * @param name              知识库名
 * @param secrecy           密级码值
 * @param status            状态（1 启用 / 0 停用）
 * @param owner             责任人用户 ID
 * @param engineType        引擎类型
 * @param settings          库级 RAG 设置
 * @param docCount          文档数
 * @param createdAt         创建时刻
 * @param updatedAt         更新时刻
 * @param engineSyncStatus  引擎同步状态码（0 未知 / 1 一致 / 2 引擎缺失 / 3 漂移或失败）
 * @param engineCheckedAt   最近一次对账 / 同步时刻
 * @param archivedAt        归档时刻；未归档为 {@code null}
 * @param engineSyncFailed  本次 update 的引擎同步是否失败
 * @param engineSyncMessage 引擎同步失败原因
 */
public record KbLibraryVO(
        Long id,
        Long categoryId,
        String name,
        String secrecy,
        Integer status,
        Long owner,
        String engineType,
        KbRagSettings settings,
        Long docCount,
        Instant createdAt,
        Instant updatedAt,
        Integer engineSyncStatus,
        Instant engineCheckedAt,
        Instant archivedAt,
        Boolean engineSyncFailed,
        String engineSyncMessage) {
}
