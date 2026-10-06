package com.mis.iqd.domain.repository;

import com.mis.iqd.domain.entity.IqdDimensionValueMap;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

/**
 * 行级范围「MIS 值 ⇄ 数仓值」映射仓储（iqd_dimension_value_map）。
 */
public interface IqdDimensionValueMapRepository extends JpaRepository<IqdDimensionValueMap, Long> {

    List<IqdDimensionValueMap> findByConnectionIdAndDimensionCodeOrderByMisValueAscIdAsc(
            Long connectionId, String dimensionCode);

    List<IqdDimensionValueMap> findByConnectionIdOrderByDimensionCodeAscMisValueAscIdAsc(
            Long connectionId);

    List<IqdDimensionValueMap> findByConnectionIdAndDimensionCodeAndMisValueIn(
            Long connectionId, String dimensionCode, List<String> misValues);

    Optional<IqdDimensionValueMap> findByConnectionIdAndDimensionCodeAndMisValueAndExternalValue(
            Long connectionId, String dimensionCode, String misValue, String externalValue);
}
