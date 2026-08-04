package com.mis.kb.domain.model;

/**
 * 创建引擎知识库的命令（由 {@code KnowledgeEnginePort.createLibrary} 消费）。
 */
public record CreateLibraryCmd(
        String name,
        String secrecy,
        Long owner,
        RagSettings settings) {
}
