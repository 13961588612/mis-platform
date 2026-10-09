package com.mis.taskflow.service;

import com.mis.taskflow.domain.entity.BizExecLock;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;

/**
 * 独占的抢锁 INSERT 执行器（P6）。
 *
 * <p>主键冲突会污染当前事务，因此把 INSERT 放在**独立 Bean 的 REQUIRES_NEW 事务**里：
 * 失败时该事务回滚并抛出，由不参与事务的调用方捕获后返回 {@code false}。
 * 若与本方法同处一个类做 try/catch，会得到 {@code UnexpectedRollbackException}。
 */
@Component
public class LockInsertExecutor {

    @PersistenceContext
    private EntityManager entityManager;

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void insert(String bizType, String bizId, String operator) {
        LocalDateTime now = LocalDateTime.now();
        BizExecLock lock = new BizExecLock();
        lock.setBizType(bizType);
        lock.setBizId(bizId);
        lock.setStatus(BizExecLock.RUNNING);
        lock.setOperatorService(operator);
        lock.setLockedAt(now);
        lock.setUpdatedAt(now);
        // persist（真正的 INSERT）：Repository.save 对已赋值复合 ID 走 merge，第二次会 UPDATE 而不冲突。
        entityManager.persist(lock);
        entityManager.flush();
    }
}
