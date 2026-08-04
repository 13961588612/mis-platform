package com.mis.kb.domain.repository;

import com.mis.kb.domain.entity.KbQaFeedback;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;

import java.util.List;
import java.util.Optional;

public interface KbQaFeedbackRepository extends JpaRepository<KbQaFeedback, Long> {

    /** 无锁读取：只读端点（{@code getFeedback} / 会话详情）用，避免行锁放大到读路径。 */
    Optional<KbQaFeedback> findBySessionId(Long sessionId);

    /**
     * 加悲观写锁读取（{@code SELECT ... FOR UPDATE}），<b>仅供 {@code submitFeedback} 写路径使用</b>。
     *
     * <p>修复 {@code editable_once} 的「读取-判断-写回」TOCTOU：两个并发的「第二次提交」
     * 若都读到 {@code editable_once=1}，会各自置 0 并 save，造成 3 次有效写入、突破一次修改语义。
     * 加行锁后，后到的事务阻塞至前一个提交，再读时已见 {@code editable_once=0}，
     * 正常抛 {@code KB_FEEDBACK_ALREADY}。
     *
     * <p><b>调用约束：</b>必须在读写事务（{@code @Transactional}，非 {@code readOnly}）内调用，
     * 否则锁随查询即刻释放、失去意义。
     *
     * <p><b>覆盖边界：</b>行锁只能锁住<b>已存在</b>的行；两个并发「首次提交」都读到空、
     * 都走 insert 的场景由 {@code kb_qa_feedback} 的唯一约束 {@code uk_kb_feedback_session}
     * （见 {@code V12__kb_schema.sql}）兜底，落库层保证无重复行。
     *
     * @param sessionId 会话 id
     * @return 该会话的反馈记录；不存在返回 {@link Optional#empty()}
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<KbQaFeedback> findWithLockBySessionId(Long sessionId);

    boolean existsBySessionId(Long sessionId);

    List<KbQaFeedback> findAll();

    /**
     * 批量取多个会话的反馈（运营列表/看板/导出用，规避 N+1）。
     *
     * @param sessionIds 会话 id 列表
     * @return 反馈列表
     */
    List<KbQaFeedback> findBySessionIdIn(List<Long> sessionIds);
}
