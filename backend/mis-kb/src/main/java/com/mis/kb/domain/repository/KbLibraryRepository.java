package com.mis.kb.domain.repository;

import com.mis.kb.domain.entity.KbLibrary;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface KbLibraryRepository extends JpaRepository<KbLibrary, Long> {

    List<KbLibrary> findByCategoryIdOrderByNameAsc(Long categoryId);

    List<KbLibrary> findByStatus(Integer status);

    List<KbLibrary> findByStatusAndSecrecy(Integer status, String secrecy);

    boolean existsByNameAndCategoryId(String name, Long categoryId);

    boolean existsByCategoryId(Long categoryId);

    Optional<KbLibrary> findByEngineLibraryRef(String engineLibraryRef);

    /**
     * 收敛清理：取「连续被标记 MISSING_IN_ENGINE 且起始时刻早于 before」的库（T04 收敛，软删）。
     *
     * @param status 引擎同步状态（取 {@code EngineSyncStatus.MISSING_IN_ENGINE}）
     * @param before 阈值时刻（含）；{@code engine_missing_since <= before} 视为达到收敛条件
     * @return 命中库列表
     */
    List<KbLibrary> findByEngineSyncStatusAndEngineMissingSinceBefore(Integer status, Instant before);
}
