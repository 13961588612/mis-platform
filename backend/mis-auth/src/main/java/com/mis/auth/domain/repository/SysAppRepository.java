package com.mis.auth.domain.repository;

import com.mis.auth.domain.entity.SysApp;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface SysAppRepository extends JpaRepository<SysApp, Long> {

    Optional<SysApp> findByCodeAndStatus(String code, Integer status);
}
