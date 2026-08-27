package com.mis.recon.service.pull;

import com.mis.recon.common.BizException;
import com.mis.recon.common.ErrorCode;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * 取数通道抽象（第四批）：db（SourceFetcher）/ api（ApiFetcher）/ custom（CustomFetcherAdapter）统一入口。
 * <p>PullRunner 批循环只依赖本接口（fetchBatch / probe），fetchOne 由各通道按能力实现
 * （db/api 支持；custom 默认不支持，走 backfill）。</p>
 */
public interface PullFetcher {

    /**
     * 取一批。
     *
     * @param lastTime 上一批尾行 time（null=首轮；api/custom 忽略，游标在通道内部推进）
     * @param lastPk   上一批尾行 keyset pk（null=首轮；api/custom 忽略）
     * @return 批；rows 为空表示拉取结束（PullRunner 循环终止）
     */
    FetchBatch fetchBatch(LocalDateTime start, LocalDateTime end,
                          LocalDateTime lastTime, String lastPk,
                          String timeField, String pkField, int batchSize);

    /** 试拉：小窗口执行一次拉取，返回样例行集（不写台账）。 */
    List<Map<String, Object>> probe(LocalDateTime start, LocalDateTime end);

    /**
     * 单条重拉（不写 pull_run；源不存在返回 null → 台账逻辑删除语义由调用方处理）。
     * 默认不支持（custom 走 backfill），db/api 各自覆盖实现。
     */
    default Map<String, Object> fetchOne(String recordKey) {
        throw new BizException(ErrorCode.FETCH_ONE_SQL_MISSING,
                "当前取数方式不支持单条重拉，请走 backfill");
    }
}
