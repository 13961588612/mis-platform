package com.mis.iqd.domain.repository;

import com.mis.iqd.domain.entity.IqdSqlPair;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface IqdSqlPairRepository extends JpaRepository<IqdSqlPair, Long> {

    List<IqdSqlPair> findByConnectionId(Long connectionId);

    List<IqdSqlPair> findByConnectionIdAndSyncStatus(Long connectionId, String syncStatus);

    List<IqdSqlPair> findByConnectionIdAndEnabled(Long connectionId, Integer enabled);

    List<IqdSqlPair> findByConnectionIdOrderByIdDesc(Long connectionId);

    Optional<IqdSqlPair> findByConnectionIdAndQuestionAndSqlText(
            Long connectionId, String question, String sqlText);
}
