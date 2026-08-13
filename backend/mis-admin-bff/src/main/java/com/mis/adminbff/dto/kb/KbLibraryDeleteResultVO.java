package com.mis.adminbff.dto.kb;

/**
 * 知识库删除回执（BFF 侧镜像，引擎删除策略 P0 / T04；Q1 两段式确认流扩展）。
 *
 * <p>字段与 mis-kb 的 {@code KbLibraryDeleteResultVO} 一一对齐，BFF 只做透传不做加工——
 * {@code message} 里那句「已归档，未删除引擎数据」是防止运维误判的关键，
 * 任何一层擅自改写文案都会把这个保护抹掉。
 *
 * <p><b>Q1 {@code engineMissing}（末位追加）：</b>引擎侧 dataset 已不存在（可能已在
 * RAGFlow 控制台手工删除）时置 {@code true}，且为 {@code null} 时前端按「未缺失」处理。
 * 用包装类型 {@link Boolean} 与既有字段风格一致（老后端未升级时不破坏反序列化）。
 *
 * @param mode         实际执行的模式（{@code archive} / {@code physical}）
 * @param engineSynced 引擎侧动作是否成功
 * @param engineError  引擎侧失败原因
 * @param archivedName 归档后引擎侧的新 dataset 名
 * @param docCleaned   清理的文档行数
 * @param aclCleaned   清理的授权行数
 * @param message      给用户看的完整说明
 * @param engineMissing 引擎侧 dataset 已不存在（Q1；包装类型，可空）
 */
public record KbLibraryDeleteResultVO(
        String mode,
        Boolean engineSynced,
        String engineError,
        String archivedName,
        Long docCleaned,
        Long aclCleaned,
        String message,
        Boolean engineMissing) {
}
