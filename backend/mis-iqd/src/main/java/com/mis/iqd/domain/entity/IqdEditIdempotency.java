package com.mis.iqd.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;

import java.time.Instant;

/**
 * 编辑幂等去重表（iqd_edit_idempotency）。
 *
 * <p>按 {@code (connection_id, idempotency_key)} 去重：前端每次提交携带
 * {@code crypto.randomUUID()} 生成的 key，服务端命中即返回首次结果且<b>不二次 bump</b>
 * revision（P0-12 / 设计 §九③）。
 */
@Entity
@Table(name = "iqd_edit_idempotency")
@IdClass(IqdEditIdempotencyId.class)
public class IqdEditIdempotency {

    @Id
    @Column(name = "connection_id", nullable = false)
    private Long connectionId;

    @Id
    @Column(name = "idempotency_key", nullable = false, length = 128)
    private String idempotencyKey;

    @Column(name = "edit_revision", nullable = false)
    private Long editRevision;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    public IqdEditIdempotency() {
    }

    public IqdEditIdempotency(Long connectionId, String idempotencyKey, Long editRevision) {
        this.connectionId = connectionId;
        this.idempotencyKey = idempotencyKey;
        this.editRevision = editRevision;
        this.createdAt = Instant.now();
    }

    public Long getConnectionId() {
        return connectionId;
    }

    public void setConnectionId(Long connectionId) {
        this.connectionId = connectionId;
    }

    public String getIdempotencyKey() {
        return idempotencyKey;
    }

    public void setIdempotencyKey(String idempotencyKey) {
        this.idempotencyKey = idempotencyKey;
    }

    public Long getEditRevision() {
        return editRevision;
    }

    public void setEditRevision(Long editRevision) {
        this.editRevision = editRevision;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }
}
