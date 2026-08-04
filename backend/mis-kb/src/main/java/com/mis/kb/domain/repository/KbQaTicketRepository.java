package com.mis.kb.domain.repository;

import com.mis.kb.domain.entity.KbQaTicket;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;

/**
 * 工单仓储（A-02c）。
 *
 * <p>派生查询方法名严格对应 {@link KbQaTicket} 的<b>实体属性名</b>（非列名）：
 * {@code status}/{@code sessionId}/{@code creatorId}/{@code processorId}/{@code createdAt}。
 */
public interface KbQaTicketRepository extends JpaRepository<KbQaTicket, Long> {

    /**
     * 按状态分页查询（状态为空时不过滤）。
     *
     * <p>用 JPQL 而非派生方法：需要「参数为 null 即忽略该条件」的语义，
     * 派生方法做不到（会生成 {@code status = null} 恒假条件）。
     *
     * @param status 状态码值；{@code null} 表示不限
     * @param pageable 分页参数
     * @return 分页结果
     */
    @Query("""
            SELECT t FROM KbQaTicket t
            WHERE (:status IS NULL OR t.status = :status)
            ORDER BY t.createdAt DESC, t.id DESC
            """)
    Page<KbQaTicket> pageByStatus(@Param("status") String status, Pageable pageable);

    /** 按会话查工单（问答详情页展示已提过的工单）。 */
    List<KbQaTicket> findBySessionIdOrderByIdDesc(Long sessionId);

    /** 统计指定状态的工单数（看板用）。 */
    long countByStatus(String status);

    /** 统计非指定状态的工单数（如「未关闭 = status <> closed」）。 */
    long countByStatusNot(String status);

    /** 统计区间内新建工单数。 */
    long countByCreatedAtBetween(Instant from, Instant to);
}
