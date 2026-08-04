package com.mis.kb.domain.model;

/**
 * 引擎侧文档引用（MIS 文档 → 引擎 doc 的映射）。
 *
 * <p>{@code engineType} 标识引擎实现；{@code nativeId} 为引擎侧文档 id。
 * 仅内部存储于 {@code kb_document.engine_document_ref}。
 */
public record EngineDocumentRef(String engineType, String nativeId) {
}
