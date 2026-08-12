package com.mis.kb.api.dto;

import java.time.Instant;

/**
 * RAPTOR 构建状态回执（{@code GET /libraries/{id}/raptor/build-status} 响应）。
 *
 * <p><b>设计 §5.2 契约（与图谱同款）：</b>状态查询每次调用会触发引擎刷新
 * （{@code KbRaptorService.refreshStatus} 调 {@code GET /datasets/{id}/index?type=raptor}，
 * 映射 progress 后与本地 {@code raptorBuildStatus} 比对，有变化才写库），
 * 因此本 VO 反映的是「引擎刚查过的最近状态」。
 *
 * <p>读操作端点默认不挂审计（U6：3s 轮询会刷审计表）。
 *
 * @param raptorBuildStatus  RAPTOR 构建状态四态 none|building|ready|failed
 * @param raptorBuildMessage 构建消息摘要（≤200；ready 时清空，failed 时存失败原因）
 * @param raptorTaskId       引擎侧 RAPTOR 构建任务 id（内部字段，仅排障展示用）
 * @param updatedAt          最近一次状态刷新（回写）时刻
 */
public record KbRaptorStatusVO(
        String raptorBuildStatus,
        String raptorBuildMessage,
        String raptorTaskId,
        Instant updatedAt) {
}
