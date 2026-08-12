package com.mis.adminbff.dto.kb;

import java.time.Instant;

/**
 * 图谱构建状态回执（BFF 侧镜像，字段与 mis-kb {@code KbGraphStatusVO} 对齐）。
 *
 * <p>Wave B GraphRAG PoC（T01）新增。前端在 {@code building} 态每 3s 轮询
 * {@code GET /libraries/{id}/graph/build-status}，直到 {@code ready}/{@code failed}。
 * 状态查询为读操作，默认不挂审计（U6：轮询刷审计表噪声）。
 *
 * @param kgBuildStatus  图谱构建状态四态 none|building|ready|failed
 * @param kgBuildMessage 构建消息摘要（≤200；ready 时清空，failed 时存失败原因）
 * @param graphragTaskId 引擎侧构图任务 id（内部字段，仅排障展示用）
 * @param updatedAt      最近一次状态刷新（回写）时刻
 */
public record KbGraphStatusVO(
        String kgBuildStatus,
        String kgBuildMessage,
        String graphragTaskId,
        Instant updatedAt) {
}
