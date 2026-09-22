package com.mis.iqd.domain.repository;

import com.mis.iqd.domain.entity.IqdModelLayout;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

/**
 * 建模台画布布局仓储（{@code iqd_model_layout}，v1.11 MR-S4）。
 *
 * <p>连接级唯一（{@code uk_iqd_model_layout_conn}），故查询以 {@code connectionId}
 * 为自然键：{@link #findByConnectionId(Long)} 命中即「已有布局」，未命中即首次保存
 * （{@code IqdModelLayoutService.save} 走 insert 而非 update）。
 *
 * <p><b>T01 仅仓储声明</b>；读写编排在 T03（{@code IqdModelLayoutService.get/save/autoLayout}）。
 */
public interface IqdModelLayoutRepository extends JpaRepository<IqdModelLayout, Long> {

    /** 按连接取布局（唯一）。 */
    Optional<IqdModelLayout> findByConnectionId(Long connectionId);

    /** 该连接是否已有布局（用于判定首次保存 / 乐观并发基线）。 */
    boolean existsByConnectionId(Long connectionId);
}
