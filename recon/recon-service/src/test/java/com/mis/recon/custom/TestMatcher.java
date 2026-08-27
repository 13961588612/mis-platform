package com.mis.recon.custom;

import com.mis.recon.domain.runtime.LedgerRow;
import com.mis.recon.domain.runtime.MatchResult;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 单测夹具：无参构造的 CustomMatcher 实现（CustomLoader 反射兜底 / 简名补全 / 接口校验用）。
 */
public class TestMatcher implements CustomMatcher {

    @Override
    public MatchResult match(Map<String, List<LedgerRow>> dataset, Map<String, Object> params) {
        return MatchResult.builder().pairs(new ArrayList<>()).unmatchedLeft(new ArrayList<>())
                .unmatchedRight(new ArrayList<>()).anomalies(new ArrayList<>()).build();
    }
}
