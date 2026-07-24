package com.mis.system.support;

import java.util.concurrent.atomic.AtomicLong;

public final class IdGenerator {

    private static final AtomicLong SEQ = new AtomicLong(System.currentTimeMillis());

    private IdGenerator() {
    }

    public static long nextId() {
        return SEQ.incrementAndGet();
    }
}
