package com.mis.iqd.domain.entity;

import java.io.Serializable;
import java.util.Objects;

/**
 * {@link IqdEditIdempotency} 复合主键（connection_id + idempotency_key）。
 */
public class IqdEditIdempotencyId implements Serializable {

    private Long connectionId;
    private String idempotencyKey;

    public IqdEditIdempotencyId() {
    }

    public IqdEditIdempotencyId(Long connectionId, String idempotencyKey) {
        this.connectionId = connectionId;
        this.idempotencyKey = idempotencyKey;
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

    @Override
    public boolean equals(Object o) {
        if (this == o) {
            return true;
        }
        if (!(o instanceof IqdEditIdempotencyId that)) {
            return false;
        }
        return Objects.equals(connectionId, that.connectionId)
                && Objects.equals(idempotencyKey, that.idempotencyKey);
    }

    @Override
    public int hashCode() {
        return Objects.hash(connectionId, idempotencyKey);
    }
}
