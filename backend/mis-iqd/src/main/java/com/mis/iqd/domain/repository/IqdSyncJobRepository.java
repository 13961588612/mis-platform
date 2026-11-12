package com.mis.iqd.domain.repository;

import com.mis.iqd.domain.entity.IqdSyncJob;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

/**
 * 问数增强同步作业仓库（iqd_sync_job）。
 *
 * <p>按连接覆盖写（一期每连接仅最新一条），{@link #findTopByConnectionIdOrderByIdDesc}
 * 取该连接最近一次作业用于状态回查。
 */
public interface IqdSyncJobRepository extends JpaRepository<IqdSyncJob, Long> {

    Optional<IqdSyncJob> findTopByConnectionIdOrderByIdDesc(Long connectionId);
}
