package com.mis.recon.repository;

import com.mis.recon.domain.query.ReconDetailEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

/**
 * 差异查询仓库（T05-spec §11，F117）：仅 DiffController 只读查询用（JPA Specification）。
 * <p><b>热路径严禁注入本 Repository</b>（依赖方向门禁：engine/dao 零 JPA 注入）。
 * 统计条走聚合查询，与列表同事务只读。</p>
 */
public interface DetailQueryRepository extends JpaRepository<ReconDetailEntity, Long>,
        JpaSpecificationExecutor<ReconDetailEntity> {

    /**
     * 统计条（待办口径）：status <> 'resolved' AND handle_status='unhandled'。
     * 与列表默认"当前差异池"口径一致（resolved=配平出池终态，不属待办；见 DetailDao 配平出池）。
     * 返回 (status, diff_type, count) 三元组行，由 Controller 汇总成 diffTypeRatio + totalConfirmedUnhandled。
     */
    @Query("""
            SELECT d.status AS status, d.diffType AS diffType, COUNT(d) AS cnt
              FROM ReconDetailEntity d
             WHERE d.status <> 'resolved'
               AND d.handleStatus = 'unhandled'
             GROUP BY d.status, d.diffType
            """)
    List<Object[]> countUnhandledGroupBy();

    /** 按场景过滤的未处理金额合计（分），供统计条：无数据返回 0。 */
    @Query("""
            SELECT COALESCE(SUM(d.diffAmountCent), 0)
              FROM ReconDetailEntity d
             WHERE d.status <> 'resolved'
               AND d.handleStatus = 'unhandled'
               AND (:scenarioCode IS NULL OR d.scenarioCode = :scenarioCode)
            """)
    long sumAmountCentUnhandled(@Param("scenarioCode") String scenarioCode);
}
