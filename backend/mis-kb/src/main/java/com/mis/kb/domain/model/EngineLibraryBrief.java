package com.mis.kb.domain.model;

import java.time.Instant;

/**
 * 引擎侧知识库（dataset）的列举摘要（引擎删除策略 P0 / T01）。
 *
 * <p>由 {@code KnowledgeEnginePort.listLibraries()} 返回，仅供<b>对账服务</b>内部使用。
 * {@code nativeId} 是引擎原生 dataset id，属于 F8 红线信息，
 * <b>禁止直接透出到前端</b>——前端只能通过带 {@code kb:library:engine-ref:view}
 * 权限码 + 审计的 {@code GET /libraries/{id}/engine-ref} 端点有限获取。
 *
 * @param nativeId      引擎原生 dataset id，恒非空
 * @param name          引擎侧 dataset 名，可能为 {@code null}（引擎返回缺字段时）
 * @param documentCount 引擎侧文档数，未知时 {@code null}
 * @param updatedAt     引擎侧最近更新时刻，未知时 {@code null}
 */
public record EngineLibraryBrief(
        String nativeId,
        String name,
        Integer documentCount,
        Instant updatedAt) {

    /**
     * 便捷构造（只有 id 与名称可用时）。
     *
     * @param nativeId 引擎原生 dataset id
     * @param name     引擎侧 dataset 名
     * @return 文档数与更新时刻为 {@code null} 的摘要
     */
    public static EngineLibraryBrief of(String nativeId, String name) {
        return new EngineLibraryBrief(nativeId, name, null, null);
    }
}
