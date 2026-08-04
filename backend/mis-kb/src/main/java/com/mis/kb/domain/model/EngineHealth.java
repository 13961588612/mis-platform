package com.mis.kb.domain.model;

/**
 * 引擎健康状态（由 {@code KnowledgeEnginePort.health()} 返回）。
 */
public record EngineHealth(boolean healthy, String status, String detail) {

    public static EngineHealth up() {
        return new EngineHealth(true, "UP", "engine reachable");
    }

    public static EngineHealth down(String detail) {
        return new EngineHealth(false, "DOWN", detail);
    }
}
