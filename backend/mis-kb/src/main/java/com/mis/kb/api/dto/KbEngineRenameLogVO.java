package com.mis.kb.api.dto;

import com.mis.kb.domain.entity.KbEngineRenameLog;

import java.time.Instant;

/**
 * 存量 dataset 重命名流水视图（P1-T4）。
 *
 * @param id         行 ID
 * @param batchId    批次号
 * @param libraryId 关联知识库 ID
 * @param engineType 引擎类型
 * @param nativeId   引擎原生 dataset id
 * @param oldName    改名前名
 * @param newName    改名后名
 * @param action     RENAME / SKIP / FAILED
 * @param status     0=未执行 1=成功 2=失败
 * @param error      失败原因
 * @param operatorId 操作者用户 ID
 * @param createdAt  写入时刻
 */
public record KbEngineRenameLogVO(
        Long id,
        String batchId,
        Long libraryId,
        String engineType,
        String nativeId,
        String oldName,
        String newName,
        String action,
        int status,
        String error,
        Long operatorId,
        Instant createdAt) {

    /** 由实体转换。 */
    public static KbEngineRenameLogVO from(KbEngineRenameLog log) {
        return new KbEngineRenameLogVO(
                log.getId(), log.getBatchId(), log.getLibraryId(), log.getEngineType(),
                log.getNativeId(), log.getOldName(), log.getNewName(), log.getAction(),
                log.getStatus(), log.getError(), log.getOperatorId(), log.getCreatedAt());
    }
}
