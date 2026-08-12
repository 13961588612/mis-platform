package com.mis.adminbff.dto.kb;

/**
 * RAPTOR 构建触发回执（BFF 侧镜像，字段与 mis-kb {@code KbRaptorBuildResultVO} 对齐）。
 *
 * <p>Wave C RAPTOR（T02）新增。构建 = 修改引擎侧资源，BFF 侧权限码
 * {@code kb:library:edit} 门控 + {@code @OperLog} 审计；mis-kb 侧另有
 * {@code hasLibraryManage} 管辖双闸门。graph/raptor 构建<b>不互斥可并行</b>
 * （T00 P2c 实测），本 VO 与 {@link KbGraphBuildResultVO} 各自独立。
 *
 * @param building          是否已进入构建流程
 * @param taskId            引擎侧 RAPTOR 构建任务 id；不可得时 {@code null}
 * @param raptorBuildStatus 触发后落库的 RAPTOR 构建状态（四态之一，触发成功恒为 building）
 */
public record KbRaptorBuildResultVO(
        boolean building,
        String taskId,
        String raptorBuildStatus) {
}
