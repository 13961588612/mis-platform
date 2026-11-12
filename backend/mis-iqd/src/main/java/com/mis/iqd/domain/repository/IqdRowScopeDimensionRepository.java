package com.mis.iqd.domain.repository;

import com.mis.iqd.domain.entity.IqdRowScopeDimension;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface IqdRowScopeDimensionRepository extends JpaRepository<IqdRowScopeDimension, Long> {

    Optional<IqdRowScopeDimension> findByDimensionCode(String dimensionCode);

    boolean existsByDimensionCode(String dimensionCode);

    boolean existsByHeaderName(String headerName);

    List<IqdRowScopeDimension> findByEnabledOrderBySortAscIdAsc(Integer enabled);

    List<IqdRowScopeDimension> findAllByOrderBySortAscIdAsc();
}
