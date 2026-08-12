package com.mis.kb.api.dto;

/**
 * 构图触发回执（{@code POST /libraries/{id}/graph/build} 响应）。
 *
 * <p><b>设计 §5.2 契约：</b>{@code building=true} 表示构图任务已在引擎侧排队；
 * {@code taskId} 为引擎侧任务 id（内部字段，仅排障展示用）；{@code kgBuildStatus}
 * 回显落库后的状态（触发成功恒为 {@code building}，引擎不支持/已在构建时走错误码
 * {@code KB_GRAPH_UNSUPPORTED}/{@code KB_GRAPH_BUILD_IN_PROGRESS}，不会返回本 VO）。
 *
 * @param building      是否已进入构建流程
 * @param taskId        引擎侧构图任务 id；不可得时 {@code null}
 * @param kgBuildStatus 触发后落库的图谱构建状态（四态之一）
 */
public record KbGraphBuildResultVO(
        boolean building,
        String taskId,
        String kgBuildStatus) {
}
