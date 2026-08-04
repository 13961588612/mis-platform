package com.mis.kb.domain.repository;

import com.mis.kb.domain.entity.KbQaMessage;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface KbQaMessageRepository extends JpaRepository<KbQaMessage, Long> {

    List<KbQaMessage> findBySessionIdOrderByIdAsc(Long sessionId);

    /**
     * 批量取多个会话的消息（运营列表/导出用，规避 N+1）。
     *
     * @param sessionIds 会话 id 列表
     * @return 消息列表，按会话与 id 升序
     */
    List<KbQaMessage> findBySessionIdInOrderBySessionIdAscIdAsc(List<Long> sessionIds);

    /** 统计某会话消息数。 */
    long countBySessionId(Long sessionId);
}
