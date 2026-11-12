package com.mis.taskflow.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.core.result.PageResult;
import com.mis.taskflow.domain.entity.SysAuditOp;
import com.mis.taskflow.domain.repository.SysAuditOpRepository;
import com.mis.taskflow.dto.AuditOpDetailVO;
import com.mis.taskflow.dto.AuditOpVO;
import com.mis.taskflow.dto.AuditStatsVO;
import com.mis.taskflow.dto.AuditTimelineItem;
import com.mis.taskflow.support.IdGenerator;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;

/**
 * 业务操作审计（P4）：写入 + 查询 + 时间线 + 统计。
 */
@Service
public class AuditOpService {

    private final SysAuditOpRepository auditRepository;

    public AuditOpService(SysAuditOpRepository auditRepository) {
        this.auditRepository = auditRepository;
    }

    /** 直接写入一条审计记录（供 AOP 切面调用）。 */
    @Transactional
    public Long save(SysAuditOp op) {
        if (op.getId() == null) {
            op.setId(IdGenerator.nextId());
        }
        if (op.getOperTime() == null) {
            op.setOperTime(LocalDateTime.now());
        }
        return auditRepository.save(op).getId();
    }

    @Transactional(readOnly = true)
    public PageResult<AuditOpVO> search(Long tenantId, Long userId, String module, String operationType,
                                        String businessType, String resultStatus, String keyword,
                                        LocalDateTime startTime, LocalDateTime endTime,
                                        int page, int size) {
        Pageable pageable = PageRequest.of(Math.max(page - 1, 0), clampSize(size));
        Page<SysAuditOp> p = auditRepository.search(tenantId, userId, blankToNull(module),
                blankToNull(operationType), blankToNull(businessType), blankToNull(resultStatus),
                startTime, endTime, blankToNull(keyword), pageable);
        return PageResult.of(page, pageable.getPageSize(), p.getTotalElements(),
                p.getContent().stream().map(this::toVo).toList());
    }

    @Transactional(readOnly = true)
    public AuditOpDetailVO detail(Long id, Long tenantId) {
        SysAuditOp op = auditRepository.findById(id)
                .filter(a -> a.getTenantId().equals(tenantId))
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "审计记录不存在"));
        return new AuditOpDetailVO(
                String.valueOf(op.getId()),
                nullableId(op.getUserId()),
                op.getUsername(),
                op.getModule(),
                op.getOperationType(),
                op.getBusinessType(),
                op.getBusinessId(),
                op.getDescription(),
                op.getBeforeData(),
                op.getAfterData(),
                op.getDiffSummary(),
                op.getTraceId(),
                op.getResultStatus(),
                op.getErrorMsg(),
                op.getDurationMs(),
                op.getExtraContext(),
                op.getOperTime());
    }

    @Transactional(readOnly = true)
    public java.util.List<AuditTimelineItem> timeline(Long tenantId, String businessType, String businessId) {
        return auditRepository
                .findByTenantIdAndBusinessTypeAndBusinessIdOrderByOperTimeAsc(tenantId, businessType, businessId)
                .stream()
                .map(a -> new AuditTimelineItem(
                        String.valueOf(a.getId()),
                        a.getOperationType(),
                        a.getDescription(),
                        a.getUsername(),
                        a.getResultStatus(),
                        a.getDiffSummary(),
                        a.getOperTime()))
                .toList();
    }

    @Transactional(readOnly = true)
    public AuditStatsVO stats(Long tenantId, int days) {
        LocalDateTime since = LocalDateTime.now().minusDays(Math.max(days, 1));
        return new AuditStatsVO(
                auditRepository.countSince(tenantId, since),
                auditRepository.countFailedSince(tenantId, since));
    }

    private AuditOpVO toVo(SysAuditOp a) {
        return new AuditOpVO(
                String.valueOf(a.getId()),
                nullableId(a.getUserId()),
                a.getUsername(),
                a.getModule(),
                a.getOperationType(),
                a.getBusinessType(),
                a.getBusinessId(),
                a.getDescription(),
                a.getResultStatus(),
                a.getDurationMs(),
                a.getOperTime());
    }

    private static int clampSize(int size) {
        if (size <= 0) {
            return 20;
        }
        return Math.min(size, 200);
    }

    private static String nullableId(Long id) {
        return id == null ? null : String.valueOf(id);
    }

    private static String blankToNull(String v) {
        return v == null || v.isBlank() ? null : v.trim();
    }
}