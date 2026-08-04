package com.mis.kb.support;

import java.util.concurrent.atomic.AtomicLong;

/**
 * 主键生成器（mirror mis-system）。
 *
 * <p>P0 单实例下使用进程内自增序列；多实例/高并发场景可替换为 Snowflake 或号段模式，
 * 当前实现足以覆盖本地、CI 与开发联调，保证主流程可编译跑通。
 */
public final class IdGenerator {

    private static final AtomicLong SEQ = new AtomicLong(System.currentTimeMillis());

    private IdGenerator() {
    }

    public static long nextId() {
        return SEQ.incrementAndGet();
    }
}
