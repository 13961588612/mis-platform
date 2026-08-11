package com.mis.kb.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;

/**
 * 知识库（kb_library）。
 *
 * <p>{@code secrecy} 复用 {@code sys_dict(kb_secrecy)} 的 value；{@code engine_library_ref}
 * 为引擎 dataset 原生 id（对外只认 MIS id）；{@code rag_settings_json} 存 {@link com.mis.kb.domain.model.RagSettings} 序列化。
 */
@Entity
@Table(name = "kb_library")
public class KbLibrary {

    @Id
    private Long id;

    @Column(name = "category_id", nullable = false)
    private Long categoryId;

    @Column(nullable = false)
    private String name;

    @Column(nullable = false)
    private String secrecy;

    @Column(nullable = false)
    private Integer status = 1;

    @Column
    private Long owner;

    @Column(name = "engine_type", nullable = false)
    private String engineType = "ragflow";

    @Column(name = "engine_library_ref")
    private String engineLibraryRef;

    @Column(name = "rag_settings_json")
    private String ragSettingsJson;

    /**
     * 引擎同步状态，码值见 {@link com.mis.kb.domain.model.EngineSyncStatus}
     * （0 未知 / 1 一致 / 2 引擎缺失 / 3 名称漂移或同步失败）。
     *
     * <p>建库默认 0；由对账服务、{@code update()} 引擎调用失败、归档改名失败三处写入。
     */
    @Column(name = "engine_sync_status", nullable = false)
    private Integer engineSyncStatus = 0;

    /** 最近一次与引擎对账 / 同步的时刻；从未对过账为 {@code null}。 */
    @Column(name = "engine_checked_at")
    private Instant engineCheckedAt;

    /**
     * 归档时刻。
     *
     * <p><b>归档判定 = {@code status == 0 && archivedAt != null}。</b>
     * 光靠 {@code status=0} 分不清「停用」（引擎名不变、可随时恢复）与
     * 「归档」（引擎侧已改名为 {@code [已归档-yyyyMMdd]-xxx}），对账时期望名也不同。
     */
    @Column(name = "archived_at")
    private Instant archivedAt;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public Long getCategoryId() {
        return categoryId;
    }

    public void setCategoryId(Long categoryId) {
        this.categoryId = categoryId;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getSecrecy() {
        return secrecy;
    }

    public void setSecrecy(String secrecy) {
        this.secrecy = secrecy;
    }

    public Integer getStatus() {
        return status;
    }

    public void setStatus(Integer status) {
        this.status = status;
    }

    public Long getOwner() {
        return owner;
    }

    public void setOwner(Long owner) {
        this.owner = owner;
    }

    public String getEngineType() {
        return engineType;
    }

    public void setEngineType(String engineType) {
        this.engineType = engineType;
    }

    public String getEngineLibraryRef() {
        return engineLibraryRef;
    }

    public void setEngineLibraryRef(String engineLibraryRef) {
        this.engineLibraryRef = engineLibraryRef;
    }

    public String getRagSettingsJson() {
        return ragSettingsJson;
    }

    public void setRagSettingsJson(String ragSettingsJson) {
        this.ragSettingsJson = ragSettingsJson;
    }

    public Integer getEngineSyncStatus() {
        return engineSyncStatus;
    }

    public void setEngineSyncStatus(Integer engineSyncStatus) {
        this.engineSyncStatus = engineSyncStatus;
    }

    public Instant getEngineCheckedAt() {
        return engineCheckedAt;
    }

    public void setEngineCheckedAt(Instant engineCheckedAt) {
        this.engineCheckedAt = engineCheckedAt;
    }

    public Instant getArchivedAt() {
        return archivedAt;
    }

    public void setArchivedAt(Instant archivedAt) {
        this.archivedAt = archivedAt;
    }

    /**
     * 是否已归档（{@code status == 0 && archivedAt != null}）。
     *
     * @return 已归档返回 {@code true}；仅「停用」返回 {@code false}
     */
    public boolean isArchived() {
        return archivedAt != null && status != null && status == 0;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(Instant updatedAt) {
        this.updatedAt = updatedAt;
    }
}
