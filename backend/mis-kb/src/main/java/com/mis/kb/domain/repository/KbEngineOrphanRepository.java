package com.mis.kb.domain.repository;

import com.mis.kb.domain.entity.KbEngineOrphan;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

/**
 * 引擎侧游离 dataset 仓储（引擎删除策略 P0 / T01）。
 *
 * <p>由 {@code KbEngineReconcileService} 独占写入；查询侧供对账报告与 P1 的认领页使用。
 */
public interface KbEngineOrphanRepository extends JpaRepository<KbEngineOrphan, Long> {

    /**
     * 按唯一键定位（upsert 用）。
     *
     * @param engineType 引擎类型
     * @param nativeId   引擎原生 dataset id
     * @return 已存在的记录
     */
    Optional<KbEngineOrphan> findByEngineTypeAndNativeId(String engineType, String nativeId);

    /**
     * 列出某引擎下待处理的游离项（最近发现的排前）。
     *
     * @param engineType 引擎类型
     * @param resolved   0 = 待处理
     * @return 游离项列表，恒非 {@code null}
     */
    List<KbEngineOrphan> findByEngineTypeAndResolvedOrderByLastSeenAtDesc(
            String engineType, Integer resolved);

    /**
     * 统计某引擎下待处理的游离项数量（重启后重算 counts 用）。
     *
     * @param engineType 引擎类型
     * @param resolved   0 = 待处理
     * @return 数量
     */
    long countByEngineTypeAndResolved(String engineType, Integer resolved);

    /**
     * 列出某引擎下已处理的游离项（最近处置的排前，P1-T3 已处理页签用）。
     *
     * <p>与 {@link #findByEngineTypeAndResolvedOrderByLastSeenAtDesc} 的区别在排序键：
     * 待处理看「最近还能看到」，已处理看「最近被谁处置」。
     *
     * @param engineType 引擎类型
     * @param resolved   1 = 已处理
     * @return 游离项列表，恒非 {@code null}
     */
    List<KbEngineOrphan> findByEngineTypeAndResolvedOrderByResolvedAtDesc(
            String engineType, Integer resolved);

    /**
     * 按处置动作过滤（P1-T3 分类统计 / 定向排查用）。
     *
     * @param engineType     引擎类型
     * @param resolvedAction 处置动作码，见 {@code KbEngineOrphanAction#code()}
     * @return 游离项列表，恒非 {@code null}
     */
    List<KbEngineOrphan> findByEngineTypeAndResolvedActionOrderByLastSeenAtDesc(
            String engineType, String resolvedAction);

    /**
     * 统计某引擎下「未经人工处置」的行数。
     *
     * <p>P1 修复 P0 的自动复位坑：只有 {@code resolved_action IS NULL} 的行才允许被
     * 下一轮对账按引擎侧可见性自动改写 {@code resolved}；已人工处置过的行不再复位。
     *
     * @param engineType 引擎类型
     * @return 数量
     */
    long countByEngineTypeAndResolvedActionIsNull(String engineType);
}
