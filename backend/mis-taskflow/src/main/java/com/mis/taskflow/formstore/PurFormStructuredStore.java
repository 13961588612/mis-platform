package com.mis.taskflow.formstore;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.taskflow.domain.entity.BizFormPurForm;
import com.mis.taskflow.domain.repository.BizFormPurFormRepository;
import com.mis.taskflow.support.IdGenerator;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * {@code PUR_FORM} → {@code biz_form_pur_form}。
 */
@Component
public class PurFormStructuredStore implements FormStructuredStore {

    public static final String FORM_CODE = "PUR_FORM";
    public static final String TABLE = "biz_form_pur_form";

    private final BizFormPurFormRepository repository;
    private final ObjectMapper objectMapper;

    public PurFormStructuredStore(BizFormPurFormRepository repository, ObjectMapper objectMapper) {
        this.repository = repository;
        this.objectMapper = objectMapper;
    }

    @Override
    public String formCode() {
        return FORM_CODE;
    }

    @Override
    public String storageTable() {
        return TABLE;
    }

    @Override
    public Long save(Long tenantId, Long operatorId, Map<String, Object> values) {
        LocalDateTime now = LocalDateTime.now();
        BizFormPurForm row = new BizFormPurForm();
        row.setId(IdGenerator.nextId());
        row.setTenantId(tenantId);
        row.setCreatedBy(operatorId);
        row.setCreatedAt(now);
        row.setUpdatedAt(now);
        row.setDeleted(0);
        applyValues(row, values);
        repository.save(row);
        return row.getId();
    }

    @Override
    public void update(Long tenantId, Long dataId, Map<String, Object> values) {
        BizFormPurForm row = require(tenantId, dataId);
        applyValues(row, values);
        row.setUpdatedAt(LocalDateTime.now());
        repository.save(row);
    }

    @Override
    public Map<String, Object> load(Long tenantId, Long dataId) {
        return toMap(require(tenantId, dataId));
    }

    @Override
    public String toSnapshot(Long tenantId, Long dataId) {
        try {
            return objectMapper.writeValueAsString(load(tenantId, dataId));
        } catch (JsonProcessingException e) {
            throw new BusinessException(ResultCode.INTERNAL_ERROR, "序列化表单快照失败");
        }
    }

    @Override
    public void bindFormRecord(Long tenantId, Long dataId, Long formRecordId) {
        BizFormPurForm row = require(tenantId, dataId);
        row.setFormRecordId(formRecordId);
        row.setUpdatedAt(LocalDateTime.now());
        repository.save(row);
    }

    private BizFormPurForm require(Long tenantId, Long dataId) {
        return repository.findByIdAndTenantIdAndDeleted(dataId, tenantId, 0)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "采购表单数据不存在"));
    }

    private void applyValues(BizFormPurForm row, Map<String, Object> values) {
        if (values == null) {
            return;
        }
        if (values.containsKey("orderNo")) {
            row.setOrderNo(asString(values.get("orderNo")));
        }
        if (values.containsKey("supplier")) {
            row.setSupplier(asString(values.get("supplier")));
        }
        if (values.containsKey("amount")) {
            row.setAmount(asDecimal(values.get("amount")));
        }
        if (values.containsKey("applyDate")) {
            row.setApplyDate(asDate(values.get("applyDate")));
        }
        if (values.containsKey("priority")) {
            row.setPriority(asString(values.get("priority")));
        }
        if (values.containsKey("categories")) {
            row.setCategories(asJsonArray(values.get("categories")));
        }
        if (values.containsKey("urgent")) {
            row.setUrgent(asBoolean(values.get("urgent")));
        }
        if (values.containsKey("reason")) {
            row.setReason(asString(values.get("reason")));
        }
    }

    private Map<String, Object> toMap(BizFormPurForm row) {
        Map<String, Object> m = new LinkedHashMap<>();
        if (row.getOrderNo() != null) {
            m.put("orderNo", row.getOrderNo());
        }
        if (row.getSupplier() != null) {
            m.put("supplier", row.getSupplier());
        }
        if (row.getAmount() != null) {
            m.put("amount", row.getAmount());
        }
        if (row.getApplyDate() != null) {
            m.put("applyDate", row.getApplyDate().toString());
        }
        if (row.getPriority() != null) {
            m.put("priority", row.getPriority());
        }
        if (row.getCategories() != null && !row.getCategories().isBlank()) {
            try {
                m.put("categories", objectMapper.readValue(row.getCategories(), List.class));
            } catch (JsonProcessingException e) {
                m.put("categories", List.of());
            }
        }
        if (row.getUrgent() != null) {
            m.put("urgent", row.getUrgent());
        }
        if (row.getReason() != null) {
            m.put("reason", row.getReason());
        }
        return m;
    }

    private static String asString(Object v) {
        if (v == null) {
            return null;
        }
        String s = String.valueOf(v).trim();
        return s.isEmpty() ? null : s;
    }

    private static BigDecimal asDecimal(Object v) {
        if (v == null || String.valueOf(v).isBlank()) {
            return null;
        }
        return new BigDecimal(String.valueOf(v));
    }

    private static LocalDate asDate(Object v) {
        if (v == null || String.valueOf(v).isBlank()) {
            return null;
        }
        return LocalDate.parse(String.valueOf(v).substring(0, 10));
    }

    private static Boolean asBoolean(Object v) {
        if (v == null) {
            return null;
        }
        if (v instanceof Boolean b) {
            return b;
        }
        return Boolean.parseBoolean(String.valueOf(v));
    }

    private String asJsonArray(Object v) {
        if (v == null) {
            return null;
        }
        try {
            if (v instanceof String s) {
                return s.isBlank() ? null : s;
            }
            return objectMapper.writeValueAsString(v);
        } catch (JsonProcessingException e) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "categories 格式无效");
        }
    }
}
