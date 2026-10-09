package com.mis.taskflow.service;

import com.mis.taskflow.domain.entity.BizExecLock;
import com.mis.taskflow.domain.repository.BizExecLockRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 分布式锁集成测试（P6）—— 真实库，验证并发恰好执行一次。
 *
 * <p>注意：本类 **不能用 @Transactional**，否则 REQUIRES_NEW 抢锁的提交会被挂起，
 * 并发实例看不到锁。改为显式清理测试数据。
 */
@SpringBootTest
@EnabledIfEnvironmentVariable(named = "MIS_DB_TEST", matches = "true")
class DistributedLockServiceTest {

    @Autowired
    private DistributedLockService lockService;

    @Autowired
    private BizExecLockRepository lockRepository;

    @Autowired
    private LockStore lockStore;

    private static final String BIZ_TYPE = "IT_LOCK_TEST";

    @Test
    @DisplayName("P6：单线程抢锁成功执行")
    void singleExecute() {
        String bizId = "single-" + System.nanoTime();
        try {
            AtomicInteger runs = new AtomicInteger();
            var outcome = lockService.executeWithLock(BIZ_TYPE, bizId, runs::incrementAndGet);
            assertEquals(DistributedLockService.LockOutcome.EXECUTED, outcome);
            assertEquals(1, runs.get());

            // 已成功：再次执行应识别为 ALREADY_SUCCESS，不再执行业务
            AtomicInteger second = new AtomicInteger();
            var again = lockService.executeWithLock(BIZ_TYPE, bizId, second::incrementAndGet);
            assertEquals(DistributedLockService.LockOutcome.ALREADY_SUCCESS, again);
            assertEquals(0, second.get(), "已成功的锁不应再次执行业务");
        } finally {
            cleanup(bizId);
        }
    }

    @Test
    @DisplayName("P6：并发 8 线程抢同一业务，动作恰好执行一次")
    void concurrentExactlyOnce() throws InterruptedException {
        String bizId = "concurrent-" + System.nanoTime();
        int threads = 8;
        AtomicInteger executions = new AtomicInteger();
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
                        lockService.executeWithLock(BIZ_TYPE, bizId, () -> {
                            executions.incrementAndGet();
                            sleepQuietly(200);
                        });
                    } catch (Exception ignored) {
                    } finally {
                        done.countDown();
                    }
                });
            }
            assertTrue(ready.await(5, TimeUnit.SECONDS));
            start.countDown();
            assertTrue(done.await(90, TimeUnit.SECONDS), "并发执行应在超时内完成");

            assertEquals(1, executions.get(), "业务动作在并发下必须恰好执行一次");
            BizExecLock lock = lockRepository.findByBizTypeAndBizId(BIZ_TYPE, bizId).orElseThrow();
            assertEquals(BizExecLock.SUCCESS, lock.getStatus());
        } finally {
            pool.shutdownNow();
            cleanup(bizId);
        }
    }

    @Test
    @DisplayName("P6：业务抛异常时锁置 FAILED，可被重新竞争")
    void failureReleasesLock() {
        String bizId = "fail-" + System.nanoTime();
        try {
            boolean threw = false;
            try {
                lockService.executeWithLock(BIZ_TYPE, bizId, () -> {
                    throw new IllegalStateException("模拟执行失败");
                });
            } catch (IllegalStateException e) {
                threw = true;
            }
            assertTrue(threw, "异常应向外传播");
            assertEquals(BizExecLock.FAILED,
                    lockRepository.findByBizTypeAndBizId(BIZ_TYPE, bizId).orElseThrow().getStatus());

            // 失败后其他实例可重新执行成功
            AtomicInteger rerun = new AtomicInteger();
            var outcome = lockService.executeWithLock(BIZ_TYPE, bizId, rerun::incrementAndGet);
            assertEquals(DistributedLockService.LockOutcome.EXECUTED, outcome);
            assertEquals(1, rerun.get());
        } finally {
            cleanup(bizId);
        }
    }

    private void cleanup(String bizId) {
        lockStore.deleteByStatus(BIZ_TYPE, bizId, BizExecLock.RUNNING);
        lockStore.deleteByStatus(BIZ_TYPE, bizId, BizExecLock.SUCCESS);
        lockStore.deleteByStatus(BIZ_TYPE, bizId, BizExecLock.FAILED);
    }

    private static void sleepQuietly(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
