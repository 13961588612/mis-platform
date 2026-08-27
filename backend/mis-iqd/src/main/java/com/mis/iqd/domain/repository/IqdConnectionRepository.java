package com.mis.iqd.domain.repository;

import com.mis.iqd.domain.entity.IqdConnection;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface IqdConnectionRepository extends JpaRepository<IqdConnection, Long> {

    Optional<IqdConnection> findByName(String name);

    boolean existsByName(String name);

    List<IqdConnection> findByEnabled(Integer enabled);

    /** 一期业务上仅一条 enabled=true：取启用连接清单（供 IqdConfigClient 全量拉取）。 */
    List<IqdConnection> findByEnabledOrderByIdAsc(Integer enabled);

    /** 推进连接级已写回版本与 mdl_hash（build 成功回调）。 */
    @Modifying
    @Query("UPDATE IqdConnection c SET c.builtEditRevision = :rev, c.builtMdlHash = :hash "
            + "WHERE c.id = :conn")
    int stampBuiltRevision(@Param("conn") Long connectionId,
                           @Param("rev") Long revision,
                           @Param("hash") String mdlHash);

    /** 置外部漂移标记（S3 漂移检测命中 / 重新导入收敛清零）。 */
    @Modifying
    @Query("UPDATE IqdConnection c SET c.staleDrift = :drift WHERE c.id = :conn")
    int setStaleDrift(@Param("conn") Long connectionId, @Param("drift") boolean drift);

    /** 回写连接级 MCP 进程状态与端口（方案 A 多连接可观测，REQ-P1-2）。 */
    @Modifying
    @Query("UPDATE IqdConnection c SET c.mcpStatus = :status, c.mcpPort = :port "
            + "WHERE c.id = :conn")
    int setMcpStatus(@Param("conn") Long connectionId,
                     @Param("status") String mcpStatus,
                     @Param("port") Integer mcpPort);
}
