package com.mis.kb.domain.model;

/**
 * 引擎侧文档摘要（文档级对账用，T03）。
 *
 * <p>由 {@code KnowledgeEnginePort.listDocuments(EngineLibraryRef)} 返回，仅含比对所需的最小字段。
 * {@code id} 为引擎原生 document id，属 F8 红线信息，仅在对账服务内部使用，不直出前端。
 *
 * @param id   引擎原生 document id，恒非空
 * @param name 引擎侧文档名
 */
public record EngineDocumentBrief(String id, String name) {
}
