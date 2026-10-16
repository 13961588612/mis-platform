package com.mis.taskflow.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.core.result.PageResult;
import com.mis.taskflow.domain.entity.FormRecord;
import com.mis.taskflow.domain.entity.WfHistory;
import com.mis.taskflow.domain.repository.FormRecordRepository;
import com.mis.taskflow.domain.repository.WfHistoryRepository;
import com.mis.taskflow.dto.FormRecordVO;
import com.mis.taskflow.dto.SaveFormRecordRequest;
import com.mis.taskflow.dto.StartFormRecordProcessRequest;
import com.mis.taskflow.dto.StartProcessRequest;
import com.mis.taskflow.formstore.FormStructuredStore;
import com.mis.taskflow.formstore.FormStructuredStoreRegistry;
import com.mis.taskflow.support.IdGenerator;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * 表单单据：保存宽表 + 生命周期；LOCAL 发起流程。
 */
@Service
public class FormRecordService {

    private final FormRecordRepository formRecordRepository;
    private final FormStructuredStoreRegistry storeRegistry;
    private final ProcessService processService;
    private final WfHistoryRepository historyRepository;

    public FormRecordService(FormRecordRepository formRecordRepository,
                             FormStructuredStoreRegistry storeRegistry,
                             ProcessService processService,
                             WfHistoryRepository historyRepository) {
        this.formRecordRepository = formRecordRepository;
        this.storeRegistry = storeRegistry;
        this.processService = processService;
        this.historyRepository = historyRepository;
    }

    @Transactional
    public Long create(Long tenantId, SaveFormRecordRequest req) {
        if (req.createdBy() == null) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "createdBy 不能为空");
        }
        FormStructuredStore store = storeRegistry.require(req.formCode());
        Long dataId = store.save(tenantId, req.createdBy(), req.values());
        String snapshot = store.toSnapshot(tenantId, dataId);

        LocalDateTime now = LocalDateTime.now();
        FormRecord record = new FormRecord();
        record.setId(IdGenerator.nextId());
        record.setTenantId(tenantId);
        record.setFormCode(store.formCode());
        record.setStatus(FormRecord.STATUS_SAVED);
        record.setStorageTable(store.storageTable());
        record.setDataId(dataId);
        record.setTitle(blankToNull(req.title()));
        record.setPayloadSnapshot(snapshot);
        record.setCreatedBy(req.createdBy());
        record.setCreatedByName(blankToNull(req.createdByName()));
        record.setCreatedAt(now);
        record.setUpdatedAt(now);
        record.setDeleted(0);
        formRecordRepository.save(record);
        store.bindFormRecord(tenantId, dataId, record.getId());
        return record.getId();
    }

    @Transactional
    public void update(Long tenantId, Long id, SaveFormRecordRequest req, Long operatorId) {
        FormRecord record = requireMineEditable(tenantId, id, operatorId);
        FormStructuredStore store = storeRegistry.require(record.getFormCode());
        store.update(tenantId, record.getDataId(), req.values());
        record.setPayloadSnapshot(store.toSnapshot(tenantId, record.getDataId()));
        if (StringUtils.hasText(req.title())) {
            record.setTitle(req.title().trim());
        }
        record.setUpdatedAt(LocalDateTime.now());
        formRecordRepository.save(record);
    }

    @Transactional(readOnly = true)
    public FormRecordVO get(Long tenantId, Long id, Long viewerId) {
        FormRecord record = formRecordRepository.findByIdAndTenantIdAndDeleted(id, tenantId, 0)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "单据不存在"));
        return toVo(tenantId, record, viewerId);
    }

    @Transactional(readOnly = true)
    public PageResult<FormRecordVO> listMine(Long tenantId, Long createdBy, String status, String formCode,
                                             int page, int size) {
        PageRequest pr = PageRequest.of(Math.max(page - 1, 0), Math.min(Math.max(size, 1), 100));
        Page<FormRecord> p = formRecordRepository.findMine(tenantId, createdBy, status, formCode, pr);
        List<FormRecordVO> list = p.getContent().stream().map(r -> toVo(tenantId, r, createdBy)).toList();
        return PageResult.of(page, pr.getPageSize(), p.getTotalElements(), list);
    }

    /**
     * 保存态单据发起本地流程：宽表快照 → startProcess；单据 → IN_PROCESS。
     */
    @Transactional
    public Long startProcess(Long tenantId, Long recordId, StartFormRecordProcessRequest req) {
        if (req.initiatorId() == null) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "initiatorId 不能为空");
        }
        FormRecord record = formRecordRepository.findByIdAndTenantIdAndDeleted(recordId, tenantId, 0)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "单据不存在"));
        if (!req.initiatorId().equals(record.getCreatedBy())) {
            throw new BusinessException(ResultCode.FORBIDDEN, "仅单据创建人可发起流程");
        }
        if (!FormRecord.STATUS_SAVED.equals(record.getStatus())) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "仅保存态单据可发起流程");
        }

        FormStructuredStore store = storeRegistry.require(record.getFormCode());
        String snapshot = store.toSnapshot(tenantId, record.getDataId());
        String businessId = StringUtils.hasText(req.businessId())
                ? req.businessId().trim()
                : ("FR-" + record.getId());

        Long instanceId = processService.startProcess(tenantId, new StartProcessRequest(
                req.definitionCode(),
                record.getFormCode(),
                businessId,
                record.getFormCode(),
                snapshot,
                req.initiatorId(),
                req.initiatorName(),
                req.appCode(),
                req.initiatorOrgName(),
                StringUtils.hasText(req.title()) ? req.title().trim() : record.getTitle(),
                req.priority(),
                req.dueDate(),
                record.getId()
        ));

        LocalDateTime now = LocalDateTime.now();
        record.setStatus(FormRecord.STATUS_IN_PROCESS);
        record.setCurrentInstanceId(instanceId);
        record.setLastInstanceId(instanceId);
        record.setPayloadSnapshot(snapshot);
        if (StringUtils.hasText(req.title())) {
            record.setTitle(req.title().trim());
        }
        record.setUpdatedAt(now);
        formRecordRepository.save(record);
        return instanceId;
    }

    private FormRecord requireMineEditable(Long tenantId, Long id, Long operatorId) {
        FormRecord record = formRecordRepository.findByIdAndTenantIdAndDeleted(id, tenantId, 0)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "单据不存在"));
        if (operatorId != null && !operatorId.equals(record.getCreatedBy())) {
            throw new BusinessException(ResultCode.FORBIDDEN, "无权修改该单据");
        }
        if (!FormRecord.STATUS_SAVED.equals(record.getStatus())
                && !FormRecord.STATUS_REJECTED.equals(record.getStatus())) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "当前状态不可编辑");
        }
        // REJECTED 编辑前归一 SAVED
        if (FormRecord.STATUS_REJECTED.equals(record.getStatus())) {
            record.setStatus(FormRecord.STATUS_SAVED);
        }
        return record;
    }

    private FormRecordVO toVo(Long tenantId, FormRecord record, Long viewerId) {
        FormStructuredStore store = storeRegistry.require(record.getFormCode());
        Map<String, Object> values = store.load(tenantId, record.getDataId());
        boolean owner = viewerId != null && viewerId.equals(record.getCreatedBy());
        boolean canEdit = owner && (FormRecord.STATUS_SAVED.equals(record.getStatus())
                || FormRecord.STATUS_REJECTED.equals(record.getStatus()));
        boolean canStart = owner && FormRecord.STATUS_SAVED.equals(record.getStatus());
        boolean canWithdraw = owner
                && FormRecord.STATUS_IN_PROCESS.equals(record.getStatus())
                && record.getCurrentInstanceId() != null
                && !hasApproveHistory(record.getCurrentInstanceId());
        return new FormRecordVO(
                String.valueOf(record.getId()),
                record.getFormCode(),
                record.getStatus(),
                record.getStorageTable(),
                String.valueOf(record.getDataId()),
                record.getCurrentInstanceId() == null ? null : String.valueOf(record.getCurrentInstanceId()),
                record.getLastInstanceId() == null ? null : String.valueOf(record.getLastInstanceId()),
                record.getTitle(),
                values,
                record.getPayloadSnapshot(),
                String.valueOf(record.getCreatedBy()),
                record.getCreatedByName(),
                record.getCreatedAt(),
                record.getUpdatedAt(),
                canEdit,
                canStart,
                canWithdraw
        );
    }

    private boolean hasApproveHistory(Long instanceId) {
        return historyRepository.findByInstanceIdOrderByCreatedAtAsc(instanceId).stream()
                .anyMatch(h -> WfHistory.OP_APPROVE.equals(h.getOperation()));
    }

    private static String blankToNull(String s) {
        return StringUtils.hasText(s) ? s.trim() : null;
    }
}
