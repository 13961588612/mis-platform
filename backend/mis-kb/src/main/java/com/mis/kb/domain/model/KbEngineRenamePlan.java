package com.mis.kb.domain.model;

/**
 * 单个库的存量重命名计划项（P1-T4）。
 *
 * @param libraryId   MIS 知识库 ID
 * @param engineType  引擎类型
 * @param nativeId    引擎原生 dataset id
 * @param oldName     改名前引擎侧实际名（来自引擎联机查询）；引擎侧缺失时为空
 * @param newName     期望的规范名（{@link KbLibraryService#expectedEngineName}）
 * @param skip        无需改（幂等已规范 / 引擎缺失 / 归档库不自动改名）
 * @param skipReason  跳过原因；{@code skip=false} 时为 {@code null}
 */
public record KbEngineRenamePlan(
        Long libraryId,
        String engineType,
        String nativeId,
        String oldName,
        String newName,
        boolean skip,
        String skipReason) {
}
