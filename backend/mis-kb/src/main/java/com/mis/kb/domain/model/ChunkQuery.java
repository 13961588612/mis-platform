package com.mis.kb.domain.model;

/**
 * 文档切片分页查询（「查看文档切分效果」）。
 *
 * <p>对外只携带 MIS 业务 ID（libraryId/documentId），引擎原生 id 由适配层翻译，
 * 绝不下发前端。{@code keywords} 为可选关键字过滤（RAGFlow 服务端过滤，
 * 现网探测结论：keywords 非空时引擎按正文关键字过滤后返回）。
 *
 * @param libraryId  MIS 知识库 id
 * @param documentId MIS 文档 id
 * @param keywords   正文关键字过滤；{@code null}/空白表示不过滤
 * @param page       页码（1-based；构造时归一化至少为 1）
 * @param pageSize   每页条数（构造时归一化至少为 1）
 */
public record ChunkQuery(
        Long libraryId,
        Long documentId,
        String keywords,
        int page,
        int pageSize) {

    public ChunkQuery {
        page = Math.max(page, 1);
        pageSize = Math.max(pageSize, 1);
    }
}
