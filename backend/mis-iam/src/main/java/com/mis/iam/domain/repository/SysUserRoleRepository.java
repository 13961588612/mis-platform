package com.mis.iam.domain.repository;

import com.mis.iam.domain.entity.SysUserRole;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface SysUserRoleRepository extends JpaRepository<SysUserRole, Long> {

    List<SysUserRole> findByUserId(Long userId);

    /** 该用户是否已分配任意角色（改 APP 守卫使用，D4 守卫） */
    boolean existsByUserId(Long userId);

    /**
     * 全量覆盖角色前先物理删除。必须 flush/clear，否则同事务紧接着 INSERT 同一
     * (user_id, role_id) 会撞 {@code uk_user_role}（Hibernate 的派生 DELETE 在 flush 时
     * 排在实体 INSERT 之后执行）。
     */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("DELETE FROM SysUserRole ur WHERE ur.userId = :userId")
    void deleteByUserId(@Param("userId") Long userId);

    void deleteByUserIdAndRoleId(Long userId, Long roleId);

    boolean existsByUserIdAndRoleId(Long userId, Long roleId);

    boolean existsByRoleId(Long roleId);
}
