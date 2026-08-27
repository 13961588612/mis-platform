package com.mis.recon.controller;

import com.mis.recon.common.ApiResponse;
import com.mis.recon.common.PageResult;
import com.mis.recon.domain.dto.DiffStatsResp;
import com.mis.recon.domain.query.ReconDetailEntity;
import com.mis.recon.repository.DetailQueryRepository;
import jakarta.persistence.criteria.Predicate;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 差异只读 API（F117，T05-spec §11）：列表 + 统计条，走 JPA Specification 查询侧。
 * <p>筛选：scenarioCode / checkName / status / diffType / handleStatus / matchKey(ilike) /
 * dateFrom~dateTo(first_seen_at 范围)；排序 first_seen_at desc；size ≤100。</p>
 */
@RestController
@RequestMapping("/internal/v1/recon/diffs")
@RequiredArgsConstructor
public class DiffController {

    private static final DateTimeFormatter TIME_FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
    private static final DateTimeFormatter DATE_FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd");

    private final DetailQueryRepository detailQueryRepository;

    /** 差异列表（只读）。 */
    @GetMapping
    public ApiResponse<PageResult<ReconDetailEntity>> page(
            @RequestParam(required = false) String scenarioCode,
            @RequestParam(required = false) String checkName,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String diffType,
            @RequestParam(required = false) String handleStatus,
            @RequestParam(required = false) String matchKey,
            @RequestParam(required = false) String dateFrom,
            @RequestParam(required = false) String dateTo,
            @RequestParam(required = false) Long diffAmountCentFrom,
            @RequestParam(required = false) Long diffAmountCentTo,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int size) {
        Specification<ReconDetailEntity> spec = buildSpec(scenarioCode, checkName, status,
                diffType, handleStatus, matchKey, dateFrom, dateTo,
                diffAmountCentFrom, diffAmountCentTo);
        PageRequest pageable = PageRequest.of(Math.max(page, 1) - 1,
                Math.min(Math.max(size, 1), 100),
                Sort.by(Sort.Direction.DESC, "firstSeenAt"));
        Page<ReconDetailEntity> result = detailQueryRepository.findAll(spec, pageable);
        return ApiResponse.ok(PageResult.from(result));
    }

    /** 统计条（未处理口径）。 */
    @GetMapping("/stats")
    public ApiResponse<DiffStatsResp> stats(@RequestParam(required = false) String scenarioCode) {
        DiffStatsResp resp = new DiffStatsResp();
        resp.setAmountCentTotal(detailQueryRepository.sumAmountCentUnhandled(scenarioCode));

        Map<String, Long> ratio = new LinkedHashMap<>();
        long confirmed = 0;
        for (Object[] row : detailQueryRepository.countUnhandledGroupBy()) {
            String s = (String) row[0];
            String type = (String) row[1];
            long cnt = ((Number) row[2]).longValue();
            ratio.merge(type, cnt, Long::sum);
            if ("confirmed".equals(s)) {
                confirmed += cnt;
            }
        }
        resp.setDiffTypeRatio(ratio);
        resp.setTotalConfirmedUnhandled(confirmed);
        resp.setTotalUnhandled(ratio.values().stream().mapToLong(Long::longValue).sum());
        return ApiResponse.ok(resp);
    }

    private Specification<ReconDetailEntity> buildSpec(String scenarioCode, String checkName, String status,
                                                       String diffType, String handleStatus, String matchKey,
                                                       String dateFrom, String dateTo,
                                                       Long diffAmountCentFrom, Long diffAmountCentTo) {
        return (root, query, cb) -> {
            List<Predicate> ps = new ArrayList<>();
            if (scenarioCode != null && !scenarioCode.isBlank()) {
                ps.add(cb.equal(root.get("scenarioCode"), scenarioCode));
            }
            if (checkName != null && !checkName.isBlank()) {
                ps.add(cb.equal(root.get("checkName"), checkName));
            }
            if (status != null && !status.isBlank()) {
                ps.add(cb.equal(root.get("status"), status));
            } else {
                // 默认口径=当前差异池：不展示已解决（resolved 为配平出池终态，见 DetailDao 配平出池；查历史可显式筛选）
                ps.add(cb.notEqual(root.get("status"), "resolved"));
            }
            if (diffType != null && !diffType.isBlank()) {
                ps.add(cb.equal(root.get("diffType"), diffType));
            }
            if (handleStatus != null && !handleStatus.isBlank()) {
                ps.add(cb.equal(root.get("handleStatus"), handleStatus));
            }
            if (matchKey != null && !matchKey.isBlank()) {
                // 匹配键同时模糊匹配 display 与 hash（hash 搜索可直接粘贴详情页的完整/截断值）
                String pattern = "%" + matchKey.toLowerCase() + "%";
                ps.add(cb.or(
                        cb.like(cb.lower(root.get("matchKeyDisplay")), pattern),
                        cb.like(cb.lower(root.get("matchKeyHash")), pattern)));
            }
            LocalDateTime from = parseDateTime(dateFrom);
            if (from != null) {
                ps.add(cb.greaterThanOrEqualTo(root.get("firstSeenAt"), from));
            }
            LocalDateTime to = parseDateTime(dateTo);
            if (to != null) {
                ps.add(cb.lessThanOrEqualTo(root.get("firstSeenAt"), to));
            }
            if (diffAmountCentFrom != null) {
                ps.add(cb.greaterThanOrEqualTo(root.get("diffAmountCent"), diffAmountCentFrom));
            }
            if (diffAmountCentTo != null) {
                ps.add(cb.lessThanOrEqualTo(root.get("diffAmountCent"), diffAmountCentTo));
            }
            return cb.and(ps.toArray(new Predicate[0]));
        };
    }

    /** 兼容 yyyy-MM-dd HH:mm:ss 与 yyyy-MM-dd（后者按当日 00:00:00 起算）。 */
    private LocalDateTime parseDateTime(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return LocalDateTime.parse(value.trim(), TIME_FMT);
        } catch (Exception e) {
            // ignore, fall through
        }
        try {
            return LocalDate.parse(value.trim(), DATE_FMT).atStartOfDay();
        } catch (Exception e) {
            return null;
        }
    }
}
