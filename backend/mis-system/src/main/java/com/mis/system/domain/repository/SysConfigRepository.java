package com.mis.system.domain.repository;

import com.mis.system.domain.entity.SysConfig;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface SysConfigRepository extends JpaRepository<SysConfig, Long> {

    List<SysConfig> findAllByOrderByIdAsc();

    boolean existsByConfigKey(String configKey);

    Optional<SysConfig> findByConfigKey(String configKey);
}
