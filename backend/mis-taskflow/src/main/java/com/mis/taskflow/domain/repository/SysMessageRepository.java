package com.mis.taskflow.domain.repository;

import com.mis.taskflow.domain.entity.SysMessage;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * 消息仓储。
 *
 * <p>{@code receiver_ids} 是 PostgreSQL {@code bigint[]}，收件箱过滤必须用原生数组运算符
 * （{@code :userId = ANY(receiver_ids)}），JPQL 不支持该语法，故用 {@code nativeQuery = true}。
 * 已读/处理状态仍由 {@code sys_message_receiver} 明细表负责。
 */
public interface SysMessageRepository extends JpaRepository<SysMessage, Long> {

    java.util.List<SysMessage> findByReferenceTaskIdAndDeleted(Long referenceTaskId, Integer deleted);

    @Query(value = """
            SELECT * FROM sys_message m
            WHERE m.tenant_id = :tenantId
              AND m.deleted = 0
              AND :userId = ANY (m.receiver_ids)
              AND (:msgType IS NULL OR m.msg_type = :msgType)
            ORDER BY m.created_at DESC
            """,
            countQuery = """
            SELECT count(*) FROM sys_message m
            WHERE m.tenant_id = :tenantId
              AND m.deleted = 0
              AND :userId = ANY (m.receiver_ids)
              AND (:msgType IS NULL OR m.msg_type = :msgType)
            """,
            nativeQuery = true)
    Page<SysMessage> findInbox(@Param("tenantId") Long tenantId,
                               @Param("userId") Long userId,
                               @Param("msgType") String msgType,
                               Pageable pageable);

    @Query(value = """
            SELECT * FROM sys_message m
            WHERE m.tenant_id = :tenantId
              AND m.deleted = 0
              AND :userId = ANY (m.receiver_ids)
              AND (lower(m.title) LIKE lower(concat('%', :keyword, '%'))
                   OR lower(coalesce(m.summary, '')) LIKE lower(concat('%', :keyword, '%')))
            ORDER BY m.created_at DESC
            """,
            countQuery = """
            SELECT count(*) FROM sys_message m
            WHERE m.tenant_id = :tenantId
              AND m.deleted = 0
              AND :userId = ANY (m.receiver_ids)
              AND (lower(m.title) LIKE lower(concat('%', :keyword, '%'))
                   OR lower(coalesce(m.summary, '')) LIKE lower(concat('%', :keyword, '%')))
            """,
            nativeQuery = true)
    Page<SysMessage> searchInbox(@Param("tenantId") Long tenantId,
                                 @Param("userId") Long userId,
                                 @Param("keyword") String keyword,
                                 Pageable pageable);
}