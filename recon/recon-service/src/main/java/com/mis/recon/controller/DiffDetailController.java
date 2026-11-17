package com.mis.recon.controller;

import com.mis.recon.common.ApiResponse;
import com.mis.recon.common.BizException;
import com.mis.recon.common.ErrorCode;
import com.mis.recon.dao.DetailDao;
import com.mis.recon.domain.dto.CompareRuleMeta;
import com.mis.recon.domain.dto.DiffDetailResp;
import com.mis.recon.domain.dto.DiffFetchOneReq;
import com.mis.recon.domain.dto.FetchOneResult;
import com.mis.recon.service.engine.ConfigSnapshot;
import com.mis.recon.service.pull.PullRunner;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 差异详情端点（V4 详情页）：单条详情 + 锚表 + 处理历史 + 状态历史 + 状态历史查询 + 单条重拉。
 */
@Slf4j
@RestController
@RequestMapping("/internal/v1/recon/diffs")
@RequiredArgsConstructor
public class DiffDetailController {

    private final DetailDao detailDao;
    private final ConfigSnapshot configSnapshot;
    private final PullRunner pullRunner;

    /** 单条差异详情（含锚表/处理历史/状态历史/check 比较规则元信息）。 */
    @GetMapping("/{id}")
    public ApiResponse<DiffDetailResp> detail(@PathVariable Long id) {
        DetailDao.DetailRow d = detailDao.findById(id);
        if (d == null) {
            throw new BizException(ErrorCode.RESOURCE_NOT_FOUND, "差异不存在");
        }
        DiffDetailResp resp = new DiffDetailResp();
        resp.setDetail(d);
        resp.setAnchors(detailDao.findAnchors(id));
        resp.setHandleHistory(detailDao.findHandleHistory(id));
        resp.setStatusHistory(detailDao.findStatusHistory(id));
        resp.setCheckCompareRules(loadCompareRuleMeta(d.scenarioCode, d.checkName));
        return ApiResponse.ok(resp);
    }

    /** 状态历史查询（时间线独立 tab 用）。 */
    @GetMapping("/{id}/status-history")
    public ApiResponse<List<DetailDao.StatusHistoryRow>> statusHistory(@PathVariable Long id) {
        if (detailDao.findById(id) == null) {
            throw new BizException(ErrorCode.RESOURCE_NOT_FOUND, "差异不存在");
        }
        return ApiResponse.ok(detailDao.findStatusHistory(id));
    }

    /** 单条重拉（按锚表行逐条调 PullRunner.fetchOne）。side 缺省两侧都拉。 */
    @PostMapping("/{id}/fetch-one")
    public ApiResponse<List<FetchOneResult>> fetchOne(@PathVariable Long id,
                                                     @Valid @RequestBody(required = false) DiffFetchOneReq req) {
        DetailDao.DetailRow d = detailDao.findById(id);
        if (d == null) {
            throw new BizException(ErrorCode.RESOURCE_NOT_FOUND, "差异不存在");
        }
        String filterSide = req == null ? null : req.getSide();
        List<DetailDao.AnchorRow> anchors = detailDao.findAnchors(id);
        List<FetchOneResult> results = new ArrayList<>();
        for (DetailDao.AnchorRow a : anchors) {
            if (filterSide != null && !filterSide.equals(a.side)) {
                continue;
            }
            FetchOneResult r = new FetchOneResult();
            r.setSide(a.side);
            r.setDsCode(a.dsCode);
            r.setRecordKey(a.recordKey);
            try {
                Map<String, Object> ret = pullRunner.fetchOne(a.dsCode, a.recordKey);
                r.setFound(Boolean.TRUE.equals(ret.get("found")));
                Object ins = ret.get("insert");
                Object upd = ret.get("update");
                r.setInsert(ins == null ? 0 : ((Number) ins).intValue());
                r.setUpdate(upd == null ? 0 : ((Number) upd).intValue());
            } catch (Exception e) {
                log.warn("[diff][fetch-one] detailId={} side={} ds={} record={} failed: {}",
                        id, a.side, a.dsCode, a.recordKey, e.getMessage());
                r.setFound(false);
                r.setError(e.getMessage());
            }
            results.add(r);
        }
        return ApiResponse.ok(results);
    }

    /** 从 ConfigSnapshot 加载 check 的比较规则元信息；check 不存在/场景禁用 → 空。 */
    private List<CompareRuleMeta> loadCompareRuleMeta(String scenarioCode, String checkName) {
        try {
            ConfigSnapshot.LoadedScenario sc = configSnapshot.load(scenarioCode);
            if (sc == null || sc.checks == null) {
                return List.of();
            }
            for (ConfigSnapshot.CheckSpec c : sc.checks) {
                if (c.checkName.equals(checkName)) {
                    List<CompareRuleMeta> list = new ArrayList<>();
                    if (c.compareRules == null) {
                        return list;
                    }
                    for (com.mis.recon.service.engine.CompareEngine.RuleConfig r : c.compareRules) {
                        CompareRuleMeta m = new CompareRuleMeta();
                        m.setName(r.name);
                        m.setLeftField(r.leftField);
                        m.setRightField(r.rightField);
                        m.setCompareMode(r.compareMode);
                        m.setAmount(r.isAmount);
                        m.setValueTransform(r.valueTransform);
                        list.add(m);
                    }
                    return list;
                }
            }
        } catch (Exception e) {
            log.warn("[diff][detail] load compare rules failed scenario={} check={}: {}",
                    scenarioCode, checkName, e.getMessage());
        }
        return List.of();
    }
}
