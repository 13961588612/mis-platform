package com.mis.taskflow.domain.repository;

import com.mis.taskflow.domain.entity.SysMessageFile;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface SysMessageFileRepository extends JpaRepository<SysMessageFile, Long> {

    Optional<SysMessageFile> findByIdAndTenantId(Long id, Long tenantId);

    List<SysMessageFile> findByTenantIdAndIdIn(Long tenantId, Collection<Long> ids);
}
