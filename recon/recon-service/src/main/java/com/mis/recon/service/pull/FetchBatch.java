package com.mis.recon.service.pull;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * 一批拉取结果（PullRunner 批循环的通用载体，db/api/custom 共用）。
 *
 * @param rows     本批行集
 * @param lastTime 批尾 time（db 键集推进；api/custom 恒为 null，分页游标在 Fetcher 内部）
 * @param lastPk   批尾 keyset pk（db 键集推进；api/custom 恒为 null）
 */
public record FetchBatch(List<Map<String, Object>> rows, LocalDateTime lastTime, String lastPk) {
}
