package com.mis.iqd.domain.repository;

import com.mis.iqd.domain.entity.IqdCatalogItem;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface IqdCatalogItemRepository extends JpaRepository<IqdCatalogItem, Long> {

    List<IqdCatalogItem> findByConnectionId(Long connectionId);

    List<IqdCatalogItem> findByConnectionIdAndKind(Long connectionId, String kind);

    List<IqdCatalogItem> findByConnectionIdAndParentKey(Long connectionId, String parentKey);

    List<IqdCatalogItem> findByConnectionIdAndInScope(Long connectionId, Integer inScope);

    Optional<IqdCatalogItem> findByConnectionIdAndItemKey(Long connectionId, String itemKey);

    boolean existsByConnectionIdAndItemKey(Long connectionId, String itemKey);

    /** 取被平台编辑过的节点（edit_revision 非空），供 build_mdl_from_catalog 派生完整 MDL。 */
    @Query(value = "SELECT * FROM iqd_catalog_item WHERE connection_id = :conn "
            + "AND edit_revision IS NOT NULL", nativeQuery = true)
    List<IqdCatalogItem> findEditedItems(@Param("conn") Long connectionId);

    /**
     * 按 revision 批量回填盖章（P0-8 / U8）：edit_revision 非空 且 ≤ built 且
     * 尚未盖此 hash 的节点置 wren_ref_id。支持断点续盖（重跑不重复改写）。
     */
    @Modifying
    @Query(value = "UPDATE iqd_catalog_item SET wren_ref_id = :hash, updated_at = CURRENT_TIMESTAMP "
            + "WHERE connection_id = :conn AND edit_revision IS NOT NULL "
            + "AND edit_revision <= :built AND (wren_ref_id IS NULL OR wren_ref_id <> :hash)",
            nativeQuery = true)
    int stampCatalogSync(@Param("conn") Long connectionId,
                         @Param("hash") String mdlHash,
                         @Param("built") Long builtRevision);

    /** 重导入（syncCatalogFromMdl）时清空历史 edit_revision / wren_ref_id，回归 WrenAI 镜像基线。 */
    @Modifying
    @Query(value = "UPDATE iqd_catalog_item SET edit_revision = NULL, wren_ref_id = NULL, "
            + "updated_at = CURRENT_TIMESTAMP WHERE connection_id = :conn", nativeQuery = true)
    int resetEditRevision(@Param("conn") Long connectionId);
}
