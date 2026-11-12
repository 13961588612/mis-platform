package com.mis.aireport.domain.repository;

import com.mis.aireport.domain.entity.AiParamSource;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface AiParamSourceRepository extends JpaRepository<AiParamSource, Long> {

    Optional<AiParamSource> findBySourceCode(String sourceCode);

    List<AiParamSource> findAllByOrderBySortOrderAscIdAsc();

    List<AiParamSource> findByEnabledOrderBySortOrderAscIdAsc(Integer enabled);
}
