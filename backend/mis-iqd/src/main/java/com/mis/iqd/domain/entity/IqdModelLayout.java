package com.mis.iqd.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;

/**
 * 问数建模台画布布局（{@code iqd_model_layout}，v1.11 MR-S4）。
 *
 * <p><b>定位（Q6 裁决）</b>：连接级**视图数据**独立存储，不动 V71 既有表结构、
 * 不参与 MDL 派生（「视图 / 模型分离」）。画布 nodes/edges 坐标 + viewport + 折叠态
 * + 自动布局版本号整体存 {@code layout_json} / {@code viewport_json}，一键自动布局
 * 可随时覆盖重建。
 *
 * <p><b>并发</b>：{@code layout_version}（列名 {@code version}）为 PUT 乐观并发基线，
 * 与 {@code body.base_version} 不符 → 40900（沿用二/四期乐观并发口径）。
 * 列名保持 {@code version}（对齐 DDL / §4.4），Java 侧命名为 {@code layoutVersion}
 * 以避免与 JPA 乐观锁语义（{@code @Version}）产生歧义。
 *
 * <p>表由 {@code V87__iqd_modeling_seed.sql} 建（mis-iqd 侧 {@code ddl-auto=validate}，
 * 因此本实体字段与 DDL 列一一对应，不得多列/少列）。
 */
@Entity
@Table(name = "iqd_model_layout")
public class IqdModelLayout {

    @Id
    private Long id;

    /** 归属问数连接（唯一：一个连接一份布局）。 */
    @Column(name = "connection_id", nullable = false)
    private Long connectionId;

    /** 画布布局 JSON：{@code {nodes:[{item_key,x,y,width,height,collapsed}], edges:[...]}}。 */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "layout_json", columnDefinition = "jsonb", nullable = false)
    private String layoutJson;

    /** 画布视口 JSON：{@code {x,y,zoom}}（可为空，空视口由前端取默认值）。 */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "viewport_json", columnDefinition = "jsonb")
    private String viewportJson;

    /** 最近一次自动布局覆盖版本（0 = 从未自动布局过）。 */
    @Column(name = "auto_layout_version", nullable = false)
    private Integer autoLayoutVersion = 0;

    /** 最后写入者（操作人标识；仅可观测，不做鉴权依据）。 */
    @Column(name = "updated_by")
    private String updatedBy;

    /** 最后写入时间。 */
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    /** 乐观并发基线（列名 {@code version}；与 PUT {@code base_version} 比对）。 */
    @Column(name = "version", nullable = false)
    private Integer layoutVersion = 0;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public Long getConnectionId() {
        return connectionId;
    }

    public void setConnectionId(Long connectionId) {
        this.connectionId = connectionId;
    }

    public String getLayoutJson() {
        return layoutJson;
    }

    public void setLayoutJson(String layoutJson) {
        this.layoutJson = layoutJson;
    }

    public String getViewportJson() {
        return viewportJson;
    }

    public void setViewportJson(String viewportJson) {
        this.viewportJson = viewportJson;
    }

    public Integer getAutoLayoutVersion() {
        return autoLayoutVersion;
    }

    public void setAutoLayoutVersion(Integer autoLayoutVersion) {
        this.autoLayoutVersion = autoLayoutVersion;
    }

    public String getUpdatedBy() {
        return updatedBy;
    }

    public void setUpdatedBy(String updatedBy) {
        this.updatedBy = updatedBy;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(Instant updatedAt) {
        this.updatedAt = updatedAt;
    }

    /** wire 字段名为 {@code version}（列名一致），Java 侧用 layoutVersion 避免 @Version 歧义。 */
    public Integer getLayoutVersion() {
        return layoutVersion;
    }

    public void setLayoutVersion(Integer layoutVersion) {
        this.layoutVersion = layoutVersion;
    }
}
