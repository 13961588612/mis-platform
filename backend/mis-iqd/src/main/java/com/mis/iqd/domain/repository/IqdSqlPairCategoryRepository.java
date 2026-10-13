package com.mis.iqd.domain.repository;

import com.mis.iqd.domain.entity.IqdSqlPairCategory;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface IqdSqlPairCategoryRepository extends JpaRepository<IqdSqlPairCategory, Long> {

    List<IqdSqlPairCategory> findByConnectionIdOrderByParentIdAscSortOrderAscIdAsc(Long connectionId);

    Optional<IqdSqlPairCategory> findByConnectionIdAndCode(Long connectionId, String code);

    long countByConnectionIdAndParentId(Long connectionId, Long parentId);

    boolean existsByIdAndConnectionId(Long id, Long connectionId);
}
