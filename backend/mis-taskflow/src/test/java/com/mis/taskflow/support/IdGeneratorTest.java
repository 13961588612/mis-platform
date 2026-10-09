package com.mis.taskflow.support;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@link IdGenerator} 单测（P1）：单调递增 + 并发唯一。
 */
class IdGeneratorTest {

    @Test
    @DisplayName("P1：nextId 严格递增")
    void monotonic() {
        long a = IdGenerator.nextId();
        long b = IdGenerator.nextId();
        assertTrue(b > a, "nextId 应严格递增");
    }

    @Test
    @DisplayName("P1：并发 8 线程各取 5000 个 ID，无重复")
    void concurrentUnique() throws InterruptedException {
        int threads = 8;
        int perThread = 5000;
        Set<Long> ids = java.util.Collections.synchronizedSet(new HashSet<>());
        AtomicInteger duplicates = new AtomicInteger();
        CountDownLatch ready = new CountDownLatch(threads);
        CountDownLatch start = new CountDownLatch(1);
        CountDownLatch done = new CountDownLatch(threads);
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        try {
            for (int i = 0; i < threads; i++) {
                pool.submit(() -> {
                    ready.countDown();
                    try {
                        start.await();
                        for (int j = 0; j < perThread; j++) {
                            if (!ids.add(IdGenerator.nextId())) {
                                duplicates.incrementAndGet();
                            }
                        }
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                    } finally {
                        done.countDown();
                    }
                });
            }
            assertTrue(ready.await(5, TimeUnit.SECONDS), "线程未就绪");
            start.countDown();
            assertTrue(done.await(20, TimeUnit.SECONDS), "线程未完成");
        } finally {
            pool.shutdownNow();
        }
        assertEquals(0, duplicates.get(), "并发下不应产生重复 ID");
        assertEquals(threads * perThread, ids.size(), "总数应与生成数一致");
    }
}