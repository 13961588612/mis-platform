package com.mis.iam.domain.repository;

import com.mis.iam.domain.entity.SysUserOrg;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface SysUserOrgRepository extends JpaRepository<SysUserOrg, Long> {

    List<SysUserOrg> findByUserId(Long userId);

    List<SysUserOrg> findByOrgIdIn(List<Long> orgIds);

    /**
     * 全量覆盖用户组织前先物理删除。必须 flush/clear，否则同事务紧接着 INSERT 同一
     * (user_id, org_id) 会撞 {@code uk_user_org}（Hibernate 的派生 DELETE 在 flush 时
     * 排在实体 INSERT 之后执行）。
     */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("DELETE FROM SysUserOrg o WHERE o.userId = :userId")
    void deleteByUserId(@Param("userId") Long userId);
}
