package com.mis.iqd.domain.repository;

import com.mis.iqd.domain.entity.IqdKnowledge;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface IqdKnowledgeRepository extends JpaRepository<IqdKnowledge, Long> {

    List<IqdKnowledge> findByConnectionId(Long connectionId);

    List<IqdKnowledge> findByConnectionIdAndKind(Long connectionId, String kind);

    List<IqdKnowledge> findByConnectionIdAndSyncStatus(Long connectionId, String syncStatus);

    List<IqdKnowledge> findByKbTermId(String kbTermId);

    List<IqdKnowledge> findByConnectionIdOrderByIdDesc(Long connectionId);

    List<IqdKnowledge> findByConnectionIdAndKindOrderByIdDesc(Long connectionId, String kind);

    Optional<IqdKnowledge> findByConnectionIdAndKindAndTitle(
            Long connectionId, String kind, String title);
}
