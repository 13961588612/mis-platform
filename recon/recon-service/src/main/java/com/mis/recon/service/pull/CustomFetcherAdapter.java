package com.mis.recon.service.pull;

import com.mis.recon.common.BizException;
import com.mis.recon.common.ErrorCode;
import com.mis.recon.custom.CustomFetcher;
import com.mis.recon.custom.FetchContext;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * custom 取数适配器（第四批 P8，取数层需求规格 §4）：把 {@link CustomFetcher} 包装成
 * PullRunner 统一的 {@link PullFetcher}。
 * <p>CustomFetcher 一次性返回全量行集（分页/重试实现类自理），本适配器按 batchSize 切片分批
 * 交给 PullRunner 批事务；probe 复用同一实现（小窗口）；fetch_one 默认不支持（走 backfill，§4.5/R11）。</p>
 */
public class CustomFetcherAdapter implements PullFetcher {

    private final CustomFetcher delegate;
    private final Map<String, Object> params;

    private List<Map<String, Object>> all;   // 全量行集（首次 fetch 缓存）
    private int offset;
    private List<Map<String, Object>> probeRows;

    public CustomFetcherAdapter(CustomFetcher delegate, Map<String, Object> params) {
        this.delegate = delegate;
        this.params = params == null ? Map.of() : params;
    }

    @Override
    public FetchBatch fetchBatch(LocalDateTime start, LocalDateTime end,
                                 LocalDateTime lastTime, String lastPk,
                                 String timeField, String pkField, int batchSize) {
        if (all == null) {
            all = fetchAll(start, end);
        }
        if (offset >= all.size()) {
            return new FetchBatch(List.of(), lastTime, lastPk);
        }
        int to = Math.min(offset + batchSize, all.size());
        List<Map<String, Object>> slice = new ArrayList<>(all.subList(offset, to));
        offset = to;
        return new FetchBatch(slice, lastTime, lastPk);
    }

    @Override
    public List<Map<String, Object>> probe(LocalDateTime start, LocalDateTime end) {
        if (probeRows == null) {
            probeRows = fetchAll(start, end);
        }
        return probeRows;
    }

    @Override
    public Map<String, Object> fetchOne(String recordKey) {
        throw new BizException(ErrorCode.FETCH_ONE_SQL_MISSING,
                "custom 数据源不支持单条重拉（fetch_one），请走 backfill");
    }

    private List<Map<String, Object>> fetchAll(LocalDateTime start, LocalDateTime end) {
        FetchContext ctx = FetchContext.builder()
                .windowStart(start)
                .windowEnd(end)
                .params(params)
                .build();
        List<Map<String, Object>> rows = delegate.fetch(ctx);
        return rows == null ? List.of() : rows;
    }
}
