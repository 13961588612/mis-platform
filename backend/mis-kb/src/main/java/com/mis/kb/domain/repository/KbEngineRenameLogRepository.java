package com.mis.kb.domain.repository;

import com.mis.kb.domain.entity.KbEngineRenameLog;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

/**
 * 存量引擎 dataset 批量重命名流水仓储（P1-T4）。
 *
 * <p>由 {@code KbEngineLegacyRenameService} 独占写入；查询侧供 BFF 的日志列表
 * 与「按批次回滚」使用。所有查询均按 {@code batchId} 分组。
 */
public interface KbEngineRenameLogRepository extends JpaRepository<KbEngineRenameLog, Long> {

    /**
     * 列出某批次的全部流水（按写入顺序倒序，最新在前）。
     *
     * @param batchId 批次号
     * @return 流水列表，恒非 {@code null}
     */
    List<KbEngineRenameLog> findByBatchIdOrderByCreatedAtDesc(String batchId);

    /**
     * 列出某批次下执行成功的行（回滚只处理这些）。
     *
     * @param batchId 批次号
     * @param status  状态，回滚传 1
     * @return 流水列表，恒非 {@code null}
     */
    List<KbEngineRenameLog> findByBatchIdAndStatus(String batchId, Integer status);

    /**
     * 批次是否存在（任何状态）。
     *
     * @param batchId 批次号
     * @return 是否存在至少一行
     */
    boolean existsByBatchId(String batchId);

    /**
     * 最近的重命名日志（按写入时间倒序，由调用方通过 {@link Pageable} 限定条数）。
     *
     * @param pageable 分页（通常 {@code PageRequest.of(0, n)}）
     * @return 日志列表，恒非 {@code null}
     */
    List<KbEngineRenameLog> findByOrderByCreatedAtDesc(Pageable pageable);

    /**
     * 取某批次最近一行（用于回填批次摘要）。
     *
     * @param batchId 批次号
     * @return 最近一行（可能空）
     */
    Optional<KbEngineRenameLog> findFirstByBatchIdOrderByCreatedAtDesc(String batchId);
}
