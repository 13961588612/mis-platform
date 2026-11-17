package com.mis.recon.repository;

import com.mis.recon.domain.config.ReconDatasource;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

/**
 * 数据源 Repository。
 * countByConnCode=被引用计数；findByConnCode=被引用 ds_code 列表（连接删除提示语用，G10）。
 */
public interface DatasourceRepository extends JpaRepository<ReconDatasource, Long> {

    Optional<ReconDatasource> findByDsCode(String dsCode);

    boolean existsByDsCode(String dsCode);

    long countByConnCode(String connCode);

    List<ReconDatasource> findByConnCode(String connCode);

    /** 启动加载调度用：enabled=1 且 pull_cron 非空（T04 F112 SchedulerManager）。 */
    @Query("SELECT d FROM ReconDatasource d WHERE d.enabled = 1 AND d.pullCron IS NOT NULL AND d.pullCron <> ''")
    List<ReconDatasource> findByEnabledAndPullCronIsNotNull();

    @Query("""
            SELECT d FROM ReconDatasource d
            WHERE (:kw IS NULL OR d.dsCode LIKE CONCAT('%', CAST(:kw AS string), '%')
                              OR d.name   LIKE CONCAT('%', CAST(:kw AS string), '%'))
              AND (:enabled IS NULL OR d.enabled = :enabled)
            """)
    Page<ReconDatasource> search(@Param("kw") String kw, @Param("enabled") Integer enabled, Pageable pageable);
}
