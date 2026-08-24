package com.mis.iqd.domain.repository;

import com.mis.iqd.domain.entity.IqdModelSnapshot;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface IqdModelSnapshotRepository extends JpaRepository<IqdModelSnapshot, Long> {

    List<IqdModelSnapshot> findByConnectionIdOrderBySyncedAtDesc(Long connectionId);

    Optional<IqdModelSnapshot> findTopByConnectionIdOrderByIdDesc(Long connectionId);
}
