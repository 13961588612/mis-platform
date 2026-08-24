package com.mis.iqd.domain.repository;

import com.mis.iqd.domain.entity.IqdConnection;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface IqdConnectionRepository extends JpaRepository<IqdConnection, Long> {

    Optional<IqdConnection> findByName(String name);

    boolean existsByName(String name);

    List<IqdConnection> findByEnabled(Integer enabled);

    /** 一期业务上仅一条 enabled=true：取启用连接清单（供 IqdConfigClient 全量拉取）。 */
    List<IqdConnection> findByEnabledOrderByIdAsc(Integer enabled);
}
