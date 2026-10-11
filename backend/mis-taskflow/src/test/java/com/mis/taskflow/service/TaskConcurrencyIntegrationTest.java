package com.mis.taskflow.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.taskflow.domain.entity.SysMessage;
import com.mis.taskflow.domain.entity.SysMessageReceiver;
import com.mis.taskflow.domain.entity.SysTask;
import com.mis.taskflow.domain.repository.SysMessageReceiverRepository;
import com.mis.taskflow.domain.repository.SysMessageRepository;
import com.mis.taskflow.domain.repository.SysTaskRepository;
import com.mis.taskflow.dto.CreateTaskRequest;
import com.mis.taskflow.dto.HandleTaskRequest;
import com.mis.taskflow.dto.TransferTaskRequest;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 待办并发保护集成测试（B3）。
 *
 * <p><b>为什么不能用类级 {@code @Transactional}</b>：那样测试数据在未提交事务里，
 * 两个线程各自开事务时<b>看不到</b>对方/测试主线程的插入行，
 * 悲观行锁会一直阻塞到超时，测不出「恰好一次」的真实语义。
 * 因此本类显式用 {@link TransactionTemplate} 开真实事务，并手工清理数据。
 *
 * <p>被测语义：{@code sys_task} 的 read-check-write 在同一把悲观行锁内完成，
 * 并发处理同一待办只能有一个成功。
 */
@SpringBootTest
@EnabledIfEnvironmentVariable(named = "MIS_DB_TEST", matches = "true")
class TaskConcurrencyIntegrationTest {

    private static final long TENANT = 900005L;

    @Autowired
    private TaskService taskService;

    @Autowired
    private SysTaskRepository taskRepository;

    @Autowired
    private SysMessageRepository messageRepository;

    @Autowired
    private SysMessageReceiverRepository receiverRepository;

    @Autowired
    private TransactionTemplate txTemplate;

    private Long createTask(long assignee) {
        return taskService.createTask(TENANT, 1L, new CreateTaskRequest(
                "PURCHASE_APPROVAL", "PURCHASE_ORDER", "PO-" + System.nanoTime(),
                "并发测试", "PURCHASE_ORDER", assignee, "处理人", (short) 2, null, "{}",
                "待审批", "请及时处理", null));
    }

    @Test
    @DisplayName("B3：两线程并发处理同一待办，恰好一个成功（悲观行锁生效）")
    void concurrentHandleExactlyOnce() throws Exception {
        long assignee = 900051L;
        Long taskId = createTask(assignee);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            CountDownLatch ready = new CountDownLatch(2);
            CountDownLatch start = new CountDownLatch(1);

            Callable<String> action = () -> {
                ready.countDown();
                start.await();
                try {
                    // 每个线程一个真实事务：handleTask 自身的 @Transactional 需独立事务才可见行锁
                    txTemplate.executeWithoutResult(status -> taskService.handleTask(
                            TENANT, taskId, new HandleTaskRequest("APPROVE", "同意", null), assignee));
                    return "OK";
                } catch (BusinessException e) {
                    return "REJECTED:" + e.getMessage();
                }
            };

            Future<String> f1 = pool.submit(action);
            Future<String> f2 = pool.submit(action);
            assertTrue(ready.await(10, TimeUnit.SECONDS), "线程应就绪");
            start.countDown();

            List<String> results = List.of(f1.get(60, TimeUnit.SECONDS), f2.get(60, TimeUnit.SECONDS));
            long okCount = results.stream().filter("OK"::equals).count();
            assertEquals(1, okCount, "并发处理必须恰好一个成功，实际: " + results);

            SysTask task = taskRepository.findById(taskId).orElseThrow();
            assertEquals("APPROVED", task.getStatus());
            assertNotNull(task.getCompletedAt());
        } finally {
            pool.shutdownNow();
            cleanup(taskId);
        }
    }

    @Test
    @DisplayName("B3：行锁在事务内被持有——他线程 handleTask 必须阻塞到提交（确定性验证，不靠线程交错运气）")
    void pessimisticLockBlocksUntilCommit() throws Exception {
        long assignee = 900054L;
        Long taskId = createTask(assignee);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            CountDownLatch lockHeld = new CountDownLatch(1);
            CountDownLatch releaseLock = new CountDownLatch(1);

            // 线程 A：显式事务内拿行锁并持有一段时间
            Future<?> holder = pool.submit(() -> {
                txTemplate.executeWithoutResult(status -> {
                    taskRepository.findByIdForUpdate(taskId).orElseThrow();
                    lockHeld.countDown();
                    try {
                        releaseLock.await(30, TimeUnit.SECONDS);
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                    }
                });
            });

            assertTrue(lockHeld.await(10, TimeUnit.SECONDS), "线程 A 应已持有行锁");

            // 线程 B：在独立事务里处理同一行——若行锁生效则被阻塞
            Future<String> contender = pool.submit(() -> {
                try {
                    txTemplate.executeWithoutResult(status -> taskService.handleTask(
                            TENANT, taskId, new HandleTaskRequest("APPROVE", "同意", null), assignee));
                    return "OK";
                } catch (Exception e) {
                    return "REJECTED:" + e.getMessage();
                }
            });

            // 未释放锁前，B 绝不应完成（无论成功还是失败）
            Thread.sleep(2000);
            assertTrue(!contender.isDone(), "行锁未释放时他线程不应完成——说明悲观锁未生效");

            releaseLock.countDown();
            holder.get(30, TimeUnit.SECONDS);
            String result = contender.get(60, TimeUnit.SECONDS);
            assertEquals("OK", result, "锁释放后处理应成功，实际: " + result);
        } finally {
            pool.shutdownNow();
            cleanup(taskId);
        }
    }

    @Test
    @DisplayName("B3：并发「处理 vs 转办」不得产生「已办但 assignee 是新人」的错配")
    void concurrentHandleVsTransferNoMismatch() throws Exception {
        long original = 900052L;
        long incoming = 900053L;
        Long taskId = createTask(original);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            CountDownLatch ready = new CountDownLatch(2);
            CountDownLatch start = new CountDownLatch(1);
            AtomicInteger unexpected = new AtomicInteger();

            Callable<Void> handle = () -> {
                ready.countDown();
                start.await();
                try {
                    txTemplate.executeWithoutResult(status -> taskService.handleTask(
                            TENANT, taskId, new HandleTaskRequest("APPROVE", "同意", null), original));
                } catch (BusinessException e) {
                    // 输掉行锁竞争：预期内（另一线程已处理）
                } catch (Exception e) {
                    unexpected.incrementAndGet();
                }
                return null;
            };
            Callable<Void> transfer = () -> {
                ready.countDown();
                start.await();
                try {
                    txTemplate.executeWithoutResult(status -> taskService.transferTask(
                            TENANT, taskId, new TransferTaskRequest(incoming, "新处理人", "接手"), original));
                } catch (BusinessException e) {
                    // 待办已被处理完，转办被拒：预期内
                } catch (Exception e) {
                    unexpected.incrementAndGet();
                }
                return null;
            };

            Future<Void> a = pool.submit(handle);
            Future<Void> b = pool.submit(transfer);
            assertTrue(ready.await(10, TimeUnit.SECONDS));
            start.countDown();
            a.get(60, TimeUnit.SECONDS);
            b.get(60, TimeUnit.SECONDS);

            assertEquals(0, unexpected.get(), "不应出现 BusinessException 以外的异常（如行锁超时/死锁）");

            SysTask task = taskRepository.findById(taskId).orElseThrow();
            if ("APPROVED".equals(task.getStatus())) {
                // 已办 ⇒ 处理人不得被改写（否则新人收到待办提醒却点进去发现已办）
                assertEquals(original, task.getAssigneeId(),
                        "任务已办时 assignee 不得变更，否则出现「已办但转给新人」错配");
            } else {
                assertEquals("PENDING", task.getStatus());
                assertEquals(incoming, task.getAssigneeId(), "转办先完成时应改写处理人且回到 PENDING");
            }
        } finally {
            pool.shutdownNow();
            cleanup(taskId);
        }
    }

    /** 手工清理：测试未走回滚，需删除代办及其关联消息/接收者明细。 */
    private void cleanup(Long taskId) {
        if (taskId == null) {
            return;
        }
        txTemplate.executeWithoutResult(status -> {
            for (SysMessage m : messageRepository.findByReferenceTaskIdAndDeleted(taskId, 0)) {
                receiverRepository.findByMessageId(m.getId())
                        .forEach(r -> receiverRepository.deleteById(r.getId()));
                messageRepository.deleteById(m.getId());
            }
            taskRepository.findById(taskId).ifPresent(taskRepository::delete);
        });
    }
}