package com.mis.iqd.domain.repository;

import com.mis.iqd.domain.entity.IqdSqlPairCategory;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface IqdSqlPairCategoryRepository extends JpaRepository<IqdSqlPairCategory, Long> {

    /**
     * 同级按 {@code code}（编号）升序；管理面「全部样本 / 未分类」为虚拟节点，不在此结果中。
     */
    List<IqdSqlPairCategory> findByConnectionIdOrderByParentIdAscCodeAscIdAsc(Long connectionId);

    Optional<IqdSqlPairCategory> findByConnectionIdAndCode(Long connectionId, String code);

    long countByConnectionIdAndParentId(Long connectionId, Long parentId);

    boolean existsByIdAndConnectionId(Long id, Long connectionId);
}
