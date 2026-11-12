package com.mis.taskflow.service;

import com.mis.taskflow.domain.entity.BizExecLock;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.Optional;

/**
 * 分布式执行锁（P6）—— 集群安全。
 *
 * <p><b>核心约束</b>：绝不能凭「UPDATE 影响行数为 0」判定成功。冲突时的处理流程：
 * <ol>
 *   <li>{@code INSERT} 抢锁：主键唯一性保证只有一个实例能写入。</li>
 *   <li>插入成功 → 本实例持有锁，可安全执行业务。</li>
 *   <li>插入失败（已在 RUNNING）→ 进入 <b>状态轮询确认</b>：只有看到对方的
 *       {@code status = SUCCESS} 才返回成功；超时未果则 <b>夺权</b>重来。</li>
 * </ol>
 *
 * <p>锁记录独立于业务事务（{@code REQUIRES_NEW}），确保即使业务回滚，锁的中间状态
 * 也能被其他实例观测到，从而正确进入「等待/夺权」分支。
 */
@Service
public class DistributedLockService {

    /** RUNNING 超过该时长视为持有者已宕机，可被夺权。 */
    private static final Duration STALE_THRESHOLD = Duration.ofMinutes(5);
    /** 冲突时的轮询总等待时长。 */
    private static final Duration POLL_TIMEOUT = Duration.ofSeconds(60);
    private static final long POLL_INTERVAL_MS = 500;

    private final LockStore lockStore;

    public DistributedLockService(LockStore lockStore) {
        this.lockStore = lockStore;
    }

    /**
     * 尝试获取执行权并执行动作。
     *
     * @param bizType  业务类型
     * @param bizId    业务 ID
     * @param action   实际业务动作（幂等）
     * @return 执行结果
     */
    public LockOutcome executeWithLock(String bizType, String bizId, Runnable action) {
        String operator = currentServiceId();
        if (tryAcquire(bizType, bizId, operator)) {
            return runAction(bizType, bizId, operator, action);
        }

        // 冲突：轮询确认对方状态
        long deadline = System.currentTimeMillis() + POLL_TIMEOUT.toMillis();
        while (System.currentTimeMillis() < deadline) {
            Optional<BizExecLock> current = lockStore.find(bizType, bizId);
            if (current.isEmpty()) {
                // 对方已释放（失败被清理），重新竞争
                if (tryAcquire(bizType, bizId, operator)) {
                    return runAction(bizType, bizId, operator, action);
                }
                continue;
            }
            BizExecLock lock = current.get();
            if (BizExecLock.SUCCESS.equals(lock.getStatus())) {
                return LockOutcome.ALREADY_SUCCESS;
            }
            if (BizExecLock.FAILED.equals(lock.getStatus())) {
                // 对方失败：清理后重新竞争
                lockStore.deleteByStatus(bizType, bizId, BizExecLock.FAILED);
                if (tryAcquire(bizType, bizId, operator)) {
                    return runAction(bizType, bizId, operator, action);
                }
                continue;
            }
            // 仍 RUNNING：判断是否超时
            if (lock.getUpdatedAt() != null
                    && Duration.between(lock.getUpdatedAt(), LocalDateTime.now()).compareTo(STALE_THRESHOLD) > 0) {
                // 夺权：删除陈旧 RUNNING 记录后重新抢
                lockStore.deleteByStatus(bizType, bizId, BizExecLock.RUNNING);
                if (tryAcquire(bizType, bizId, operator)) {
                    return runAction(bizType, bizId, operator, action);
                }
            }
            sleep(POLL_INTERVAL_MS);
        }
        return LockOutcome.TIMEOUT;
    }

    /** INSERT 抢锁；主键冲突返回 false。 */
    public boolean tryAcquire(String bizType, String bizId, String operator) {
        return lockStore.insertLock(bizType, bizId, operator);
    }

    private LockOutcome runAction(String bizType, String bizId, String operator, Runnable action) {
        try {
            action.run();
            lockStore.casStatus(bizType, bizId, BizExecLock.RUNNING, BizExecLock.SUCCESS, operator);
            return LockOutcome.EXECUTED;
        } catch (Exception e) {
            // 标记失败，供其他实例重新竞争
            lockStore.casStatus(bizType, bizId, BizExecLock.RUNNING, BizExecLock.FAILED, operator);
            throw e;
        }
    }

    private static void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private static String currentServiceId() {
        String host;
        try {
            host = java.net.InetAddress.getLocalHost().getHostName();
        } catch (Exception e) {
            host = "unknown";
        }
        return host + ":" + ProcessHandle.current().pid();
    }

    /** 执行结果。 */
    public enum LockOutcome {
        /** 本实例执行了动作。 */
        EXECUTED,
        /** 其他实例已完成（确认到 SUCCESS）。 */
        ALREADY_SUCCESS,
        /** 等待超时仍无法确认。 */
        TIMEOUT
    }
}
