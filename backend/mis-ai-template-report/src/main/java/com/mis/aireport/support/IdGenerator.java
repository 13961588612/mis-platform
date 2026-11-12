package com.mis.aireport.support;

import java.util.concurrent.atomic.AtomicLong;

/** 进程内自增主键（对齐 mis-iqd / mis-kb；多实例可换 Snowflake）。 */
public final class IdGenerator {

    private static final AtomicLong SEQ = new AtomicLong(System.currentTimeMillis());

    private IdGenerator() {
    }

    public static long nextId() {
        return SEQ.incrementAndGet();
    }
}
