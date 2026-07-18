package com.mis.org.support;

import java.util.concurrent.atomic.AtomicLong;

public final class IdGenerator {

    private static final AtomicLong SEQUENCE = new AtomicLong(System.currentTimeMillis());

    private IdGenerator() {
    }

    public static long nextId() {
        return SEQUENCE.incrementAndGet();
    }
}
