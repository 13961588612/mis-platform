package com.mis.adminbff.dto.kb;

/**
 * 构图触发回执（BFF 侧镜像，字段与 mis-kb {@code KbGraphBuildResultVO} 对齐）。
 *
 * <p>Wave B GraphRAG PoC（T02）新增。构图 = 修改引擎侧资源，BFF 侧权限码
 * {@code kb:library:edit} 门控 + {@code @OperLog} 审计；mis-kb 侧另有
 * {@code hasLibraryManage} 管辖双闸门。
 *
 * @param building      是否已进入构建流程
 * @param taskId        引擎侧构图任务 id；不可得时 {@code null}
 * @param kgBuildStatus 触发后落库的图谱构建状态（四态之一，触发成功恒为 building）
 */
public record KbGraphBuildResultVO(
        boolean building,
        String taskId,
        String kgBuildStatus) {
}
