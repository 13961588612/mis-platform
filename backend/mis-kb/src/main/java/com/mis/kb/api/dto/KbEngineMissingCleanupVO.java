package com.mis.kb.api.dto;

import java.time.Instant;

/**
 * 人工收敛端点（POST /internal/v1/kb/engine/cleanup-missing）的回执（T04）。
 *
 * <p>收敛「连续 N 次被标记 MISSING_IN_ENGINE 的本地残留」：库走可逆软删
 * （status=0 + archivedAt=now），孤儿文档直接物理删行。本端点是显式、人工触发的出口，
 * 区别于定时任务的 auto-clean-missing 自动模式。
 *
 * @param librariesCleaned 软删的库数量
 * @param documentsCleaned 物理删除的孤儿文档数量
 * @param at              收敛执行时刻
 * @param note            说明文案
 */
public record KbEngineMissingCleanupVO(
        int librariesCleaned, int documentsCleaned, Instant at, String note) {
}
