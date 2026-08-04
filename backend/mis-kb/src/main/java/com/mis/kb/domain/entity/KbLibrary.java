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
