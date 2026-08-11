package com.mis.kb.api.dto;

import com.mis.kb.domain.model.RagSettings;

import java.time.Instant;

/**
 * 知识库视图对象（对外只含 MIS ID；不暴露 {@code engine_library_ref} 引擎原生 id）。
 *
 * <p><b>T03 末位追加 5 个字段</b>，前 11 个分量与顺序保持不动（BFF 侧是按名映射的
 * record，追加在末位对既有调用点零影响）：
 * <ul>
 *   <li>{@code engineSyncStatus} / {@code engineCheckedAt}：对账结果，列表页渲染同步徽标；</li>
 *   <li>{@code archivedAt}：归档标记，配合 {@code status==0} 区分「停用」与「归档」；</li>
 *   <li>{@code engineSyncFailed} / {@code engineSyncMessage}：<b>仅 {@code update()} 回执填</b>，
 *       {@code list}/{@code get}/{@code detail} 恒为 {@code null}。这两个是「本次调用的瞬时结果」
 *       而非库的持久属性，塞进 VO 是为了让保存成功但引擎同步失败的场景在前端立刻可见，
 *       不必再去查对账报告。</li>
 * </ul>
 *
 * <p><b>engine_library_ref 仍然不在这里</b>（F8 红线）。需要 dataset_id 的场景走独立端点
 * {@link KbEngineRefVO}，那条路带独立权限码与审计。
 *
 * @param id               MIS 知识库 ID
 * @param categoryId       所属分类 ID
 * @param name             知识库名（MIS 侧原始名，非引擎侧加工名）
 * @param secrecy          密级码值
 * @param status           状态（1 启用 / 0 停用）
 * @param owner            责任人用户 ID
 * @param engineType       引擎类型
 * @param settings         库级 RAG 设置
 * @param docCount         文档数
 * @param createdAt        创建时刻
 * @param updatedAt        更新时刻
 * @param engineSyncStatus 引擎同步状态码，见 {@link com.mis.kb.domain.model.EngineSyncStatus}
 * @param engineCheckedAt  最近一次对账 / 同步时刻
 * @param archivedAt       归档时刻；未归档为 {@code null}
 * @param engineSyncFailed 本次调用的引擎同步是否失败（仅 update 回执填）
 * @param engineSyncMessage 引擎同步失败原因（仅 update 回执填）
 */
public record KbLibraryVO(
        Long id,
        Long categoryId,
        String name,
        String secrecy,
        Integer status,
        Long owner,
        String engineType,
        RagSettings settings,
        Long docCount,
        Instant createdAt,
        Instant updatedAt,
        Integer engineSyncStatus,
        Instant engineCheckedAt,
        Instant archivedAt,
        Boolean engineSyncFailed,
        String engineSyncMessage) {

    /**
     * 带同步瞬时结果的副本（{@code update()} 回执专用）。
     *
     * <p>record 是不可变的，这里返回新实例而不是就地改字段——避免调用方误以为
     * 这两个瞬时字段会被持久化。
     *
     * @param failed  引擎同步是否失败
     * @param message 失败原因，成功时传 {@code null}
     * @return 复制了全部持久字段、仅替换两个瞬时字段的新实例
     */
    public KbLibraryVO withEngineSyncResult(Boolean failed, String message) {
        return new KbLibraryVO(
                id, categoryId, name, secrecy, status, owner, engineType, settings, docCount,
                createdAt, updatedAt, engineSyncStatus, engineCheckedAt, archivedAt,
                failed, message);
    }
}
