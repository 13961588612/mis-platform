package com.mis.iam.domain.repository;

import com.mis.iam.domain.entity.SysUserDept;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface SysUserDeptRepository extends JpaRepository<SysUserDept, Long> {

    List<SysUserDept> findByUserId(Long userId);

    List<SysUserDept> findByDeptIdIn(List<Long> deptIds);

    @Modifying
    @Query("DELETE FROM SysUserDept d WHERE d.userId = :userId")
    void deleteByUserId(@Param("userId") Long userId);
}
