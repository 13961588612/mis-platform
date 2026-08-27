package com.mis.recon.repository;

import com.mis.recon.domain.config.ReconConnection;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;

/**
 * 连接 Repository（G11：分页+过滤用 @Query JPQL 单方法，唯一键/存在性用方法名派生）。
 * 跨表被引用计数不在本接口（G10：放 Service 用 DatasourceRepository）。
 */
public interface ConnectionRepository extends JpaRepository<ReconConnection, Long> {

    Optional<ReconConnection> findByConnCode(String connCode);

    boolean existsByConnCode(String connCode);

    @Query("""
            SELECT c FROM ReconConnection c
            WHERE (:kw IS NULL OR c.connCode LIKE CONCAT('%', CAST(:kw AS string), '%')
                              OR c.name   LIKE CONCAT('%', CAST(:kw AS string), '%'))
              AND (:enabled IS NULL OR c.enabled = :enabled)
            """)
    Page<ReconConnection> search(@Param("kw") String kw, @Param("enabled") Integer enabled, Pageable pageable);
}
