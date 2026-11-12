package com.mis.taskflow.domain.repository;

import com.mis.taskflow.domain.entity.SysMessageReceiver;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface SysMessageReceiverRepository extends JpaRepository<SysMessageReceiver, Long> {

    List<SysMessageReceiver> findByMessageId(Long messageId);

    Optional<SysMessageReceiver> findByMessageIdAndUserId(Long messageId, Long userId);

    List<SysMessageReceiver> findByMessageIdInAndUserId(List<Long> messageIds, Long userId);

    /** 未读计数（用于角标）。 */
    @Query("""
            select count(r) from SysMessageReceiver r
            where r.tenantId = :tenantId and r.userId = :userId and r.read = false
            """)
    long countUnread(@Param("tenantId") Long tenantId, @Param("userId") Long userId);

    /** 已读人数（用于主表 read_count 回写）。 */
    @Query("select count(r) from SysMessageReceiver r where r.messageId = :messageId and r.read = true")
    long countReadByMessageId(@Param("messageId") Long messageId);

    /** 总接收人数（已读率分母）。 */
    long countByMessageId(Long messageId);

    /** 我收到的消息总数（角标统计分母）。 */
    long countByTenantIdAndUserId(Long tenantId, Long userId);
}