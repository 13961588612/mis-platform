package com.mis.iqd.domain.repository;

import com.mis.iqd.domain.entity.IqdCatalogItem;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface IqdCatalogItemRepository extends JpaRepository<IqdCatalogItem, Long> {

    List<IqdCatalogItem> findByConnectionId(Long connectionId);

    List<IqdCatalogItem> findByConnectionIdAndKind(Long connectionId, String kind);

    List<IqdCatalogItem> findByConnectionIdAndParentKey(Long connectionId, String parentKey);

    List<IqdCatalogItem> findByConnectionIdAndInScope(Long connectionId, Integer inScope);

    Optional<IqdCatalogItem> findByConnectionIdAndItemKey(Long connectionId, String itemKey);

    boolean existsByConnectionIdAndItemKey(Long connectionId, String itemKey);
}
