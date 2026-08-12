package com.mis.adminbff.dto.kb;

import java.time.Instant;

/**
 * RAPTOR 构建状态回执（BFF 侧镜像，字段与 mis-kb {@code KbRaptorStatusVO} 对齐）。
 *
 * <p>Wave C RAPTOR（T01）新增。前端在 {@code building} 态每 3s 轮询
 * {@code GET /libraries/{id}/raptor/build-status}，直到 {@code ready}/{@code failed}。
 * 状态查询为读操作，默认不挂审计（U6：轮询刷审计表噪声）。
 * graph/raptor 构建<b>不互斥可并行</b>（T00 P2c 实测），本 VO 与 {@link KbGraphStatusVO}
 * 各自独立轮询。
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
