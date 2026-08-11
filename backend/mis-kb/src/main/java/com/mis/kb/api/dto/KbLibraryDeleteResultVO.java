package com.mis.kb.api.dto;

/**
 * 知识库「删除」端点回执（引擎删除策略 P0 / T03）。
 *
 * <p><b>为什么删除要返回一个回执体而不是 204：</b>旧版 {@code delete} 把引擎异常
 * 吞掉后照样返回成功，运维以为引擎侧数据已经清干净，实际 dataset 还躺在 RAGFlow 里
 * 继续占存储、继续被别的库检索命中。现在把「引擎侧到底做了什么」如实写进回执，
 * 由前端逐条渲染。
 *
 * <p><b>破坏性语义提醒：</b>不带 {@code mode} 调 {@code DELETE} 时走的是<b>归档</b>，
 * {@link #message} 必须明说「已归档，未删除引擎数据」。
 *
 * @param mode         实际执行的模式（{@code archive} / {@code physical}）
 * @param engineSynced 引擎侧动作是否成功；归档时改名失败仍返回 {@code false} 但整体成功
 * @param engineError  引擎侧失败原因；成功为 {@code null}
 * @param archivedName 归档后引擎侧的新 dataset 名；物理删除或改名失败为 {@code null}
 * @param docCleaned   清理的文档行数（归档恒为 0）
 * @param aclCleaned   清理的授权行数（归档恒为 0）
 * @param message      给用户看的完整说明（前端直接展示，不要自己再拼一遍）
 */
public record KbLibraryDeleteResultVO(
        String mode,
        boolean engineSynced,
        String engineError,
        String archivedName,
        long docCleaned,
        long aclCleaned,
        String message) {
}
