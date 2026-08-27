package com.mis.recon.repository;

import com.mis.recon.domain.config.ReconCheck;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

/**
 * 检查 Repository。分页 search 含 scenario_code 必选过滤 + keyword（checkName 模糊）+ enabled 可选。
 */
public interface CheckRepository extends JpaRepository<ReconCheck, Long> {

    Optional<ReconCheck> findByScenarioCodeAndCheckName(String scenarioCode, String checkName);

    boolean existsByScenarioCodeAndCheckName(String scenarioCode, String checkName);

    List<ReconCheck> findByScenarioCodeOrderBySeqNo(String scenarioCode);

    List<ReconCheck> findByScenarioCodeAndEnabled(String scenarioCode, Integer enabled);

    @Query("""
            SELECT c FROM ReconCheck c
            WHERE c.scenarioCode = :scenarioCode
              AND (:kw IS NULL OR c.checkName LIKE CONCAT('%', CAST(:kw AS string), '%'))
              AND (:enabled IS NULL OR c.enabled = :enabled)
            """)
    Page<ReconCheck> search(@Param("scenarioCode") String scenarioCode,
                            @Param("kw") String kw,
                            @Param("enabled") Integer enabled,
                            Pageable pageable);

    /** 数据源删除保护：consume_json 行内 ds_code 精确匹配（JSONB 存在性，避免 LIKE 误报） */
    @Query(value = """
            SELECT * FROM recon_check c
            WHERE EXISTS (
                SELECT 1 FROM jsonb_each(c.consume_json) e
                WHERE e.value->>'ds_code' = :dsCode
            )
            """, nativeQuery = true)
    List<ReconCheck> findRefByConsumeDsCode(@Param("dsCode") String dsCode);
}
