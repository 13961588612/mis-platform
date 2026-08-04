package com.mis.kb.domain.repository;

import com.mis.kb.domain.entity.KbQaSession;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.Instant;
import java.util.List;

public interface KbQaSessionRepository extends JpaRepository<KbQaSession, Long> {

    List<KbQaSession> findByUserIdOrderByIdDesc(Long userId);

    boolean existsByIdAndUserId(Long id, Long userId);

    /**
     * 时间区间内的会话（倒序）。
     *
     * <p>属性名 {@code createdAt} 对应列 {@code created_at}，见 {@link KbQaSession}。
     * 运营列表/看板/导出共用此入口，区间由调用方兜底为「很早 ~ 现在」。
     *
     * @param from 起始时间（含）
     * @param to   结束时间（含）
     * @return 区间内会话，按 id 倒序
     */
    List<KbQaSession> findByCreatedAtBetweenOrderByIdDesc(Instant from, Instant to);

    /** 区间内会话数（看板用）。 */
    long countByCreatedAtBetween(Instant from, Instant to);
}
