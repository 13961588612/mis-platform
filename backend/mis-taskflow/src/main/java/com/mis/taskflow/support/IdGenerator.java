package com.mis.taskflow.support;

import java.util.concurrent.atomic.AtomicLong;

/**
 * 雪花风格的自增 ID 生成器（与 mis-system 对齐）。
 *
 * <p>单库单表场景下用于生成实体主键；分布式场景建议后续替换为统一发号器。
 */
public final class IdGenerator {

    private static final AtomicLong SEQ = new AtomicLong(System.currentTimeMillis());

    private IdGenerator() {
    }

    public static long nextId() {
        return SEQ.incrementAndGet();
    }
}