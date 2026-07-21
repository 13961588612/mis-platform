package com.mis.system.domain.repository;

import com.mis.system.domain.entity.SysMenu;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface SysMenuRepository extends JpaRepository<SysMenu, Long> {

    List<SysMenu> findByAppIdAndStatusOrderBySortAscCodeAsc(Long appId, Integer status);

    List<SysMenu> findByAppIdOrderBySortAscCodeAsc(Long appId);

    List<SysMenu> findByIdInAndStatus(Collection<Long> ids, Integer status);

    Optional<SysMenu> findByAppIdAndCode(Long appId, String code);

    boolean existsByAppIdAndPermissionAndStatus(Long appId, String permission, Integer status);

    boolean existsByParentIdAndStatus(Long parentId, Integer status);
}
