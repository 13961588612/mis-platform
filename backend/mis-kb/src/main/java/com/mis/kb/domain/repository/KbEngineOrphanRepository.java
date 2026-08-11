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
}
