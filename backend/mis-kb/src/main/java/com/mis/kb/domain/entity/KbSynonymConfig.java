package com.mis.kb.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;

/**
 * 同义词全局配置（kb_synonym_config，Wave D）。<b>单行表，id 恒为 1</b>。
 *
 * <p>{@code enabled} 是业务开关（S-07 页面可写）。与 Nacos 的
 * {@code mis.kb.synonym.enabled} 熔断闸是<b>双闸</b>关系：任一为 false 即不扩展（Q2）。
 *
 * <p>{@code dictVersion} 是<b>跨实例词典一致性的唯一权威源</b>（设计 §4.2）：
 * 任何词表写操作都要在同一事务内 {@code dict_version + 1}，其它实例每 3 秒轮询这一行的
 * 主键查，版本变了才做全量重载。这就是「不引入 Redis」这个取舍的落点。
 */
@Entity
@Table(name = "kb_synonym_config")
public class KbSynonymConfig {

    /** 单行表的固定主键。 */
    public static final long SINGLETON_ID = 1L;

    /** 开关：启用。 */
    public static final int ENABLED_YES = 1;
    /** 开关：停用。 */
    public static final int ENABLED_NO = 0;

    @Id
    private Long id;

    @Column(nullable = false)
    private Integer enabled = ENABLED_YES;

    @Column(name = "dict_version", nullable = false)
    private Long dictVersion = 1L;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Column(name = "updated_by")
    private Long updatedBy;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public Integer getEnabled() {
        return enabled;
    }

    public void setEnabled(Integer enabled) {
        this.enabled = enabled;
    }

    public Long getDictVersion() {
        return dictVersion;
    }

    public void setDictVersion(Long dictVersion) {
        this.dictVersion = dictVersion;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(Instant updatedAt) {
        this.updatedAt = updatedAt;
    }

    public Long getUpdatedBy() {
        return updatedBy;
    }

    public void setUpdatedBy(Long updatedBy) {
        this.updatedBy = updatedBy;
    }

    /**
     * 库内业务开关是否为开。
     *
     * @return {@code enabled == 1} 返回 {@code true}
     */
    public boolean isEnabledFlag() {
        return enabled != null && enabled == ENABLED_YES;
    }
}
