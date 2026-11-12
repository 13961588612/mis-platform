package com.mis.iqd.domain.repository;

import com.mis.iqd.domain.entity.IqdDatasource;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface IqdDatasourceRepository extends JpaRepository<IqdDatasource, Long> {

    List<IqdDatasource> findByConnectionId(Long connectionId);

    List<IqdDatasource> findByConnectionIdAndEnabled(Long connectionId, Integer enabled);

    /** 字典同步目标库清单（scope_sync_enabled=true，B4 中心每日同步作业使用）。 */
    List<IqdDatasource> findByScopeSyncEnabled(Integer scopeSyncEnabled);

    /** 启用且开启字典同步的目标库清单（W2 同步作业按 enabled + scope_sync_enabled 过滤）。 */
    List<IqdDatasource> findByEnabledAndScopeSyncEnabled(Integer enabled, Integer scopeSyncEnabled);
}
