package com.mis.aireport.domain.repository;

import com.mis.aireport.domain.entity.AiReportStoreDim;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface AiReportStoreDimRepository extends JpaRepository<AiReportStoreDim, Long> {

    List<AiReportStoreDim> findByEnabledOrderByStoreCodeAsc(Integer enabled);

    List<AiReportStoreDim> findByIdInAndEnabledOrderByStoreCodeAsc(Collection<Long> ids, Integer enabled);

    Optional<AiReportStoreDim> findByStoreCodeAndEnabled(String storeCode, Integer enabled);
}
