package com.mis.kb.domain.repository;

import com.mis.kb.domain.entity.KbSynonymImportBatch;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

/**
 * 同义词导入批次仓储（Wave D）。
 *
 * <p>预检计划落库是多实例可达性的前提（预检在实例 A、提交在实例 B），
 * 详见 {@link KbSynonymImportBatch} 的类注释。
 */
public interface KbSynonymImportBatchRepository extends JpaRepository<KbSynonymImportBatch, Long> {

    /**
     * 按预检令牌定位批次。
     *
     * @param token 预检令牌
     * @return 批次；不存在返回 {@link Optional#empty()}
     */
    Optional<KbSynonymImportBatch> findByToken(String token);
}
