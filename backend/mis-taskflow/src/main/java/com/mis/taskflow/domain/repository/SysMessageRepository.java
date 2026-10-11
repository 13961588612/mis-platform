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

    /**
     * 收件箱分页 —— 应用级过滤（{@code scope=APP}）。
     *
     * <p>与 {@link #findInbox} 逐字一致，仅多一个<b>无条件等值</b>
     * {@code AND m.app_code = :appCode}。刻意不写 {@code (:appCode IS NULL OR ...)}——
     * native query 中 null 参与 {@code IS NULL} 比较会触发 PostgreSQL/Hibernate 的
     * 参数类型推断缺陷（本仓既有 {@code could not determine data type of parameter} 事故），
     * 故按 scope 拆成独立方法，与 {@link #searchInboxByType} 同范式。
     */
    @Query(value = """
            SELECT * FROM sys_message m
            WHERE m.tenant_id = :tenantId
              AND m.deleted = 0
              AND :userId = ANY (m.receiver_ids)
              AND m.app_code = :appCode
              AND (:msgType IS NULL OR m.msg_type = :msgType)
            ORDER BY m.created_at DESC
            """,
            countQuery = """
            SELECT count(*) FROM sys_message m
            WHERE m.tenant_id = :tenantId
              AND m.deleted = 0
              AND :userId = ANY (m.receiver_ids)
              AND m.app_code = :appCode
              AND (:msgType IS NULL OR m.msg_type = :msgType)
            """,
            nativeQuery = true)
    Page<SysMessage> findInboxByApp(@Param("tenantId") Long tenantId,
                                    @Param("userId") Long userId,
                                    @Param("msgType") String msgType,
                                    @Param("appCode") String appCode,
                                    Pageable pageable);

    /**
     * 收件箱分页 —— 平台级过滤（{@code scope=PLATFORM}）。
     *
     * <p>与 {@link #findInbox} 逐字一致，仅多一个无条件条件 {@code AND m.app_code IS NULL}。
     */
    @Query(value = """
            SELECT * FROM sys_message m
            WHERE m.tenant_id = :tenantId
              AND m.deleted = 0
              AND :userId = ANY (m.receiver_ids)
              AND m.app_code IS NULL
              AND (:msgType IS NULL OR m.msg_type = :msgType)
            ORDER BY m.created_at DESC
            """,
            countQuery = """
            SELECT count(*) FROM sys_message m
            WHERE m.tenant_id = :tenantId
              AND m.deleted = 0
              AND :userId = ANY (m.receiver_ids)
              AND m.app_code IS NULL
              AND (:msgType IS NULL OR m.msg_type = :msgType)
            """,
            nativeQuery = true)
    Page<SysMessage> findInboxPlatform(@Param("tenantId") Long tenantId,
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

    /**
     * 类型内关键词检索（标题 + 摘要）—— 各消息子 Tab 的独立搜索。
     *
     * <p>与 {@link #searchInbox} 的 SQL 完全一致，仅**多一个无条件等值** {@code AND m.msg_type = :msgType}
     * 置于 keyword 条件之前。
     *
     * <p>⚠️ <b>刻意不用</b> {@code (:msgType IS NULL OR m.msg_type = :msgType)}：本 SQL 为 native query，
     * 若 {@code :msgType} 出现在 {@code IS NULL} 中，PostgreSQL/Hibernate 会报
     * {@code could not determine data type of parameter}。用无条件等值，{:@code :msgType} 仅出现在
     * {@code m.msg_type = :msgType}，类型由 varchar 列锚定，零歧义。调用方负责在 {@code msgType} 为空时
     * 改走跨类型的 {@link #searchInbox}。
     */
    @Query(value = """
            SELECT * FROM sys_message m
            WHERE m.tenant_id = :tenantId
              AND m.deleted = 0
              AND :userId = ANY (m.receiver_ids)
              AND m.msg_type = :msgType
              AND (lower(m.title) LIKE lower(concat('%', :keyword, '%'))
                   OR lower(coalesce(m.summary, '')) LIKE lower(concat('%', :keyword, '%')))
            ORDER BY m.created_at DESC
            """,
            countQuery = """
            SELECT count(*) FROM sys_message m
            WHERE m.tenant_id = :tenantId
              AND m.deleted = 0
              AND :userId = ANY (m.receiver_ids)
              AND m.msg_type = :msgType
              AND (lower(m.title) LIKE lower(concat('%', :keyword, '%'))
                   OR lower(coalesce(m.summary, '')) LIKE lower(concat('%', :keyword, '%')))
            """,
            nativeQuery = true)
    Page<SysMessage> searchInboxByType(@Param("tenantId") Long tenantId,
                                       @Param("userId") Long userId,
                                       @Param("msgType") String msgType,
                                       @Param("keyword") String keyword,
                                       Pageable pageable);

    /** 跨类型检索 + 应用级过滤（{@code scope=APP}）：{@link #searchInbox} 加无条件等值 {@code AND m.app_code = :appCode}。 */
    @Query(value = """
            SELECT * FROM sys_message m
            WHERE m.tenant_id = :tenantId
              AND m.deleted = 0
              AND :userId = ANY (m.receiver_ids)
              AND m.app_code = :appCode
              AND (lower(m.title) LIKE lower(concat('%', :keyword, '%'))
                   OR lower(coalesce(m.summary, '')) LIKE lower(concat('%', :keyword, '%')))
            ORDER BY m.created_at DESC
            """,
            countQuery = """
            SELECT count(*) FROM sys_message m
            WHERE m.tenant_id = :tenantId
              AND m.deleted = 0
              AND :userId = ANY (m.receiver_ids)
              AND m.app_code = :appCode
              AND (lower(m.title) LIKE lower(concat('%', :keyword, '%'))
                   OR lower(coalesce(m.summary, '')) LIKE lower(concat('%', :keyword, '%')))
            """,
            nativeQuery = true)
    Page<SysMessage> searchInboxByApp(@Param("tenantId") Long tenantId,
                                      @Param("userId") Long userId,
                                      @Param("keyword") String keyword,
                                      @Param("appCode") String appCode,
                                      Pageable pageable);

    /** 跨类型检索 + 平台级过滤（{@code scope=PLATFORM}）：{@link #searchInbox} 加无条件 {@code AND m.app_code IS NULL}。 */
    @Query(value = """
            SELECT * FROM sys_message m
            WHERE m.tenant_id = :tenantId
              AND m.deleted = 0
              AND :userId = ANY (m.receiver_ids)
              AND m.app_code IS NULL
              AND (lower(m.title) LIKE lower(concat('%', :keyword, '%'))
                   OR lower(coalesce(m.summary, '')) LIKE lower(concat('%', :keyword, '%')))
            ORDER BY m.created_at DESC
            """,
            countQuery = """
            SELECT count(*) FROM sys_message m
            WHERE m.tenant_id = :tenantId
              AND m.deleted = 0
              AND :userId = ANY (m.receiver_ids)
              AND m.app_code IS NULL
              AND (lower(m.title) LIKE lower(concat('%', :keyword, '%'))
                   OR lower(coalesce(m.summary, '')) LIKE lower(concat('%', :keyword, '%')))
            """,
            nativeQuery = true)
    Page<SysMessage> searchInboxPlatform(@Param("tenantId") Long tenantId,
                                         @Param("userId") Long userId,
                                         @Param("keyword") String keyword,
                                         Pageable pageable);

    /** 类型内检索 + 应用级过滤（{@code scope=APP}）：{@link #searchInboxByType} 加无条件等值 {@code AND m.app_code = :appCode}。 */
    @Query(value = """
            SELECT * FROM sys_message m
            WHERE m.tenant_id = :tenantId
              AND m.deleted = 0
              AND :userId = ANY (m.receiver_ids)
              AND m.msg_type = :msgType
              AND m.app_code = :appCode
              AND (lower(m.title) LIKE lower(concat('%', :keyword, '%'))
                   OR lower(coalesce(m.summary, '')) LIKE lower(concat('%', :keyword, '%')))
            ORDER BY m.created_at DESC
            """,
            countQuery = """
            SELECT count(*) FROM sys_message m
            WHERE m.tenant_id = :tenantId
              AND m.deleted = 0
              AND :userId = ANY (m.receiver_ids)
              AND m.msg_type = :msgType
              AND m.app_code = :appCode
              AND (lower(m.title) LIKE lower(concat('%', :keyword, '%'))
                   OR lower(coalesce(m.summary, '')) LIKE lower(concat('%', :keyword, '%')))
            """,
            nativeQuery = true)
    Page<SysMessage> searchInboxByTypeAndApp(@Param("tenantId") Long tenantId,
                                             @Param("userId") Long userId,
                                             @Param("msgType") String msgType,
                                             @Param("keyword") String keyword,
                                             @Param("appCode") String appCode,
                                             Pageable pageable);

    /** 类型内检索 + 平台级过滤（{@code scope=PLATFORM}）：{@link #searchInboxByType} 加无条件 {@code AND m.app_code IS NULL}。 */
    @Query(value = """
            SELECT * FROM sys_message m
            WHERE m.tenant_id = :tenantId
              AND m.deleted = 0
              AND :userId = ANY (m.receiver_ids)
              AND m.msg_type = :msgType
              AND m.app_code IS NULL
              AND (lower(m.title) LIKE lower(concat('%', :keyword, '%'))
                   OR lower(coalesce(m.summary, '')) LIKE lower(concat('%', :keyword, '%')))
            ORDER BY m.created_at DESC
            """,
            countQuery = """
            SELECT count(*) FROM sys_message m
            WHERE m.tenant_id = :tenantId
              AND m.deleted = 0
              AND :userId = ANY (m.receiver_ids)
              AND m.msg_type = :msgType
              AND m.app_code IS NULL
              AND (lower(m.title) LIKE lower(concat('%', :keyword, '%'))
                   OR lower(coalesce(m.summary, '')) LIKE lower(concat('%', :keyword, '%')))
            """,
            nativeQuery = true)
    Page<SysMessage> searchInboxByTypePlatform(@Param("tenantId") Long tenantId,
                                               @Param("userId") Long userId,
                                               @Param("msgType") String msgType,
                                               @Param("keyword") String keyword,
                                               Pageable pageable);
}