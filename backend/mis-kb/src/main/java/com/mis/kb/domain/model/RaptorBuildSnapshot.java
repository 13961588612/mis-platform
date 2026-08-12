package com.mis.kb.domain.model;

/**
 * RAPTOR 构建状态快照（引擎侧 {@code GET /datasets/{id}/index?type=raptor} 映射结果）。
 *
 * <p><b>T00 P2b 实测契约（设计 §1.1 / 探测记录 §1）：</b>引擎 task dict 的
 * {@code progress} 语义为 <b>1.0=完成 / -1=失败 / 其他=构建中</b>；{@code progress_msg}
 * 为构建日志（失败/构建中时摘要落 {@code raptorBuildMessage}）；{@code process_duration}
 * 为构建耗时（秒）；{@code task_type="raptor"}。与 {@link GraphBuildSnapshot} 完全同构
 * （T00 P2c 实测 graph/raptor 构建<b>不互斥、可并行</b>，各自独立状态机）。
 *
 * <p>本快照由 {@code KnowledgeEnginePort.queryRaptorBuildStatus(ref)} 返回，
 * {@link com.mis.kb.domain.service.KbRaptorService} 负责映射到 MIS 侧
 * {@code raptorBuildStatus} 四态并回写 {@code rag_settings_json}
 * （U3：落库为唯一事实源 + 查询时引擎刷新回写）。
 *
 * @param taskId            引擎侧 RAPTOR 构建任务 id；无任务/不支持时 {@code null}
 * @param progress          构建进度 0~1（1.0=完成，-1=失败）；无任务时 {@code null}
 * @param status            状态枚举 BUILDING|READY|FAILED；无任务时 {@code NONE}
 * @param progressMsg       引擎侧 {@code progress_msg} 摘要；无任务时 {@code null}
 * @param processDurationMs 构建耗时毫秒；不可得时 {@code null}
 */
public record RaptorBuildSnapshot(
        String taskId,
        Double progress,
        Status status,
        String progressMsg,
        Long processDurationMs) {

    /** RAPTOR 构建状态（引擎侧 progress 映射后）。 */
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
    public static RaptorBuildSnapshot none() {
        return new RaptorBuildSnapshot(null, null, Status.NONE, null, null);
    }
}
