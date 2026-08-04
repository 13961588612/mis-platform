package com.mis.kb.domain.model;

/**
 * 引擎侧知识库引用（MIS 知识库 → 引擎 dataset 的映射）。
 *
 * <p>{@code engineType} 标识引擎实现（如 {@code ragflow}）；{@code nativeId} 为引擎侧 dataset id。
 * 对外禁止暴露，仅内部存储于 {@code kb_library.engine_library_ref}。
 */
public record EngineLibraryRef(String engineType, String nativeId) {
}
