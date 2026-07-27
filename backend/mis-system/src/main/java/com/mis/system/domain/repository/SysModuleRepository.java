package com.mis.system.domain.repository;

import com.mis.system.domain.entity.SysModule;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface SysModuleRepository extends JpaRepository<SysModule, Long> {

    boolean existsByCode(String code);

    boolean existsByCodeAndIdNot(String code, Long id);

    List<SysModule> findByStatus(Integer status);

    List<SysModule> findByOrderBySortAscCodeAsc();

    Optional<SysModule> findByCode(String code);
}
