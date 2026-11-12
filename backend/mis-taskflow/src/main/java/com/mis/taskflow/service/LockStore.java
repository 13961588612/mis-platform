package com.mis.taskflow.service;

import com.mis.taskflow.domain.entity.BizExecLock;
import com.mis.taskflow.domain.repository.BizExecLockRepository;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.Optional;

/**
 * 锁表存取（P6）。
 *
 * <p>每个方法独立事务（{@code REQUIRES_NEW}），由 Spring 代理生效——这是
 * {@link DistributedLockService} 能在轮询期间观测到其他实例锁状态的前提：
 * 抢锁的 INSERT 必须立即提交，不能被外层长事务包裹。
 */
@Component
public class LockStore {

    private final BizExecLockRepository lockRepository;
    private final LockInsertExecutor lockInsertExecutor;

    public LockStore(BizExecLockRepository lockRepository, LockInsertExecutor lockInsertExecutor) {
        this.lockRepository = lockRepository;
        this.lockInsertExecutor = lockInsertExecutor;
    }

    /**
     * 原子抢锁：主键冲突返回 false。
     *
     * <p>本方法**不参与事务**，INSERT 由 {@link LockInsertExecutor} 在独立 REQUIRES_NEW
     * 事务中完成；失败事务回滚后在此捕获，故不会污染调用方事务。
     */
    public boolean insertLock(String bizType, String bizId, String operator) {
        try {
            lockInsertExecutor.insert(bizType, bizId, operator);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    @Transactional(readOnly = true)
    public Optional<BizExecLock> find(String bizType, String bizId) {
        return lockRepository.findByBizTypeAndBizId(bizType, bizId);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public int casStatus(String bizType, String bizId, String expected, String next, String operator) {
        return lockRepository.casStatus(bizType, bizId, expected, next, operator, LocalDateTime.now());
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public int deleteByStatus(String bizType, String bizId, String status) {
        return lockRepository.deleteByStatus(bizType, bizId, status);
    }
}
