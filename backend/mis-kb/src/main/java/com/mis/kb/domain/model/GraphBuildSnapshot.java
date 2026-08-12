package com.mis.kb.domain.model;

/**
 * 图谱构建状态快照（引擎侧 {@code GET /datasets/{id}/index?type=graph} 映射结果）。
 *
 * <p><b>T00 G3 实测契约（设计 §1.1 / §2.3）：</b>引擎 task dict 的 {@code progress}
 * 语义为 <b>1.0=完成 / -1=失败 / 其他=构建中</b>；{@code progress_msg} 为构建日志
 * （失败/构建中时摘要落 {@code kgBuildMessage}）；{@code process_duration} 为构建耗时（秒）。
 *
 * <p>本快照由 {@code KnowledgeEnginePort.queryGraphBuildStatus(ref)} 返回，
 * {@link KbGraphService} 负责映射到 MIS 侧 {@code kgBuildStatus} 四态并回写
 * {@code rag_settings_json}（U3：落库为唯一事实源 + 查询时引擎刷新回写）。
 *
 * @param taskId            引擎侧构图任务 id；无任务/不支持时 {@code null}
 * @param progress          构建进度 0~1（1.0=完成，-1=失败）；无任务时 {@code null}
 * @param status            状态枚举 BUILDING|READY|FAILED；无任务时 {@code NONE}
 * @param progressMsg       引擎侧 {@code progress_msg} 摘要；无任务时 {@code null}
 * @param processDurationMs 构建耗时毫秒；不可得时 {@code null}
 */
public record GraphBuildSnapshot(
        String taskId,
        Double progress,
        Status status,
        String progressMsg,
        Long processDurationMs) {

    /** 图谱构建状态（引擎侧 progress 映射后）。 */
    public enum Status {
        /** 无任务/引擎不支持（本地保持原值，不写库）。 */
        NONE,
        /** 构建中（progress ∉ {-1, 1}）。 */
        BUILDING,
        /** 已完成（progress == 1.0）。 */
        READY,
        /** 已失败（progress < 0）。 */
        FAILED
    }

    /** 无任务/不支持时的空快照（{@code status=NONE}）。 */
    public static GraphBuildSnapshot none() {
        return new GraphBuildSnapshot(null, null, Status.NONE, null, null);
    }
}
