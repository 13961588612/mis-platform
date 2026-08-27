package com.mis.kb.api.dto;

import java.time.Instant;

/**
 * 文档视图对象（不暴露 {@code engine_document_ref} 引擎原生 id）。
 *
 * <p>企业级增强一期（KE-03/KE-04）末位追加 {@code parseProgress} / {@code parseError}：
 * 解析进度百分比与失败原因摘要，来源引擎状态同步回写（见 {@code KbDocumentService}）。
 * @param pageIndex               文件级页码索引/TOC 提取开关（null = 继承库级；只落库不下发）
 * @param imageTableContextWindow 文件级图像/表格上下文窗口 token 数（null = 继承库级；只落库不下发）
 * @param autoKeywords            文件级自动关键字数量（null = 继承库级；0 = 关闭）
 * @param autoQuestions           文件级自动问题数量（null = 继承库级；0 = 关闭）
 */
public record KbDocumentVO(
        Long id,
        Long libraryId,
        String title,
        Integer version,
        String parseStatus,
        Integer enabled,
        Long size,
        String format,
        Instant createdAt,
        Instant updatedAt,
        String chunkMethod,
        Integer chunkTokenNum,
        String separator,
        Integer parseProgress,
        String parseError,
        Boolean pageIndex,
        Integer imageTableContextWindow,
        Integer autoKeywords,
        Integer autoQuestions) {
}
