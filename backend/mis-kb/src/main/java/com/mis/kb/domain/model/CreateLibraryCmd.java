package com.mis.kb.domain.model;

/**
 * 创建引擎知识库的命令（由 {@code KnowledgeEnginePort.createLibrary} 消费）。
 *
 * <p><b>T02 增加 {@code libraryId} 与 {@code topCategoryName} 两个分量</b>：
 * 引擎侧 dataset 名要按 {@code {一级分类名}-{库名}-{MIS库ID后6位}} 拼，
 * adapter 必须拿得到这两样。这带来一个连锁改动——{@code KbLibraryService.create()}
 * 原本是「先调引擎、后生成 MIS ID」，现在必须<b>把 {@code IdGenerator.nextId()} 提前</b>
 * 到调引擎之前，否则 {@code libraryId} 恒为 0。
 *
 * @param name            MIS 知识库名（<b>原始名，未经引擎侧命名加工</b>）
 * @param secrecy         密级码值
 * @param owner           责任人用户 ID，可为 {@code null}
 * @param settings        库级 RAG 设置，可为 {@code null}
 * @param libraryId       MIS 知识库 ID（调引擎前已生成）
 * @param topCategoryName 该库所属分类向上回溯到根的那一级名称；查不到时传
 *                        {@code null}，adapter 会回落到「未分类」
 */
public record CreateLibraryCmd(
        String name,
        String secrecy,
        Long owner,
        RagSettings settings,
        long libraryId,
        String topCategoryName) {
}
