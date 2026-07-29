package com.mis.iam.domain.repository;

import com.mis.iam.domain.entity.SysUserOrg;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface SysUserOrgRepository extends JpaRepository<SysUserOrg, Long> {

    List<SysUserOrg> findByUserId(Long userId);

    @Modifying
    @Query("DELETE FROM SysUserOrg o WHERE o.userId = :userId")
    void deleteByUserId(@Param("userId") Long userId);
}
