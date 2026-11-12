package com.mis.iqd.domain.repository;

import com.mis.iqd.domain.entity.IqdEditIdempotency;
import com.mis.iqd.domain.entity.IqdEditIdempotencyId;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

/**
 * 编辑幂等去重表仓库（iqd_edit_idempotency）。
 *
 * <p>按 {@code (connection_id, idempotency_key)} 查重，命中即表示本次编辑已落库，
 * 返回首次结果且不再 bump revision（P0-12）。
 */
public interface IqdEditIdempotencyRepository extends JpaRepository<IqdEditIdempotency, IqdEditIdempotencyId> {

    Optional<IqdEditIdempotency> findByConnectionIdAndIdempotencyKey(Long connectionId, String idempotencyKey);
}
