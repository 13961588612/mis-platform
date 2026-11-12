package com.mis.taskflow.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.taskflow.domain.entity.FormRecord;
import com.mis.taskflow.domain.entity.WfInstance;
import com.mis.taskflow.domain.repository.BizFormPurFormRepository;
import com.mis.taskflow.domain.repository.FormRecordRepository;
import com.mis.taskflow.domain.repository.WfInstanceRepository;
import com.mis.taskflow.domain.repository.WfTaskRepository;
import com.mis.taskflow.dto.CompleteWfTaskRequest;
import com.mis.taskflow.dto.CreateDefinitionRequest;
import com.mis.taskflow.dto.SaveFormRecordRequest;
import com.mis.taskflow.dto.StartFormRecordProcessRequest;
import com.mis.taskflow.dto.WfNodeDTO;
import com.mis.taskflow.support.FormTestFixtures;
import com.mis.taskflow.support.TaskflowStatus;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * PUR_FORM 宽表保存 + 发起 + 首节点撤回 + 再发。
 */
@SpringBootTest
@ActiveProfiles("test")
@Transactional
class FormRecordWithdrawIntegrationTest {

    private static final long TENANT = 1L;
    private static final long USER = 880001L;
    private static final long APPROVER = 880002L;

    @Autowired
    private FormRecordService formRecordService;
    @Autowired
    private FormDefinitionService formDefinitionService;
    @Autowired
    private WfDefinitionService definitionService;
    @Autowired
    private ProcessService processService;
    @Autowired
    private FormRecordRepository formRecordRepository;
    @Autowired
    private BizFormPurFormRepository purFormRepository;
    @Autowired
    private WfInstanceRepository instanceRepository;
    @Autowired
    private WfTaskRepository wfTaskRepository;

    private String publishPurFlow() {
        FormTestFixtures.register(formDefinitionService, TENANT, "PUR_FORM", "采购申请");
        String code = "WF_FR_" + System.nanoTime();
        Long defId = definitionService.create(TENANT, USER, new CreateDefinitionRequest(
                code, "单据撤回测", "APPROVAL", null, List.of("PUR_FORM"), "{}",
                List.of(
                        new WfNodeDTO("start", "开始", "START", 0, null, null, null, "{}", null, "{}"),
                        new WfNodeDTO("approve", "审批", "APPROVAL", 1, null, null, null,
                                "{\"type\":\"FIXED\",\"value\":" + APPROVER + "}", 24, "{}"),
                        new WfNodeDTO("end", "结束", "END", 2, null, null, null, "{}", null, "{}")
                )));
        definitionService.activate(defId, TENANT);
        return code;
    }

    @Test
    @DisplayName("保存宽表 → 发起 → 撤回回 SAVED → 再发新实例")
    void saveStartWithdrawResubmit() {
        String defCode = publishPurFlow();

        Map<String, Object> values = new LinkedHashMap<>();
        values.put("orderNo", "PO-FR-1");
        values.put("supplier", "供应商A");
        values.put("amount", 1000);
        values.put("applyDate", "2026-10-16");
        values.put("priority", "NORMAL");
        values.put("urgent", false);
        values.put("reason", "联调");

        Long recordId = formRecordService.create(TENANT, new SaveFormRecordRequest(
                "PUR_FORM", values, "采购联调", USER, "测试人"));
        FormRecord saved = formRecordRepository.findById(recordId).orElseThrow();
        assertEquals(FormRecord.STATUS_SAVED, saved.getStatus());
        assertTrue(purFormRepository.findById(saved.getDataId()).isPresent());
        assertEquals("PO-FR-1", purFormRepository.findById(saved.getDataId()).orElseThrow().getOrderNo());

        Long inst1 = formRecordService.startProcess(TENANT, recordId, new StartFormRecordProcessRequest(
                defCode, "BIZ-1", "标题1", (short) 2, null, USER, "测试人", null, null));
        FormRecord inProcess = formRecordRepository.findById(recordId).orElseThrow();
        assertEquals(FormRecord.STATUS_IN_PROCESS, inProcess.getStatus());
        assertEquals(inst1, inProcess.getCurrentInstanceId());

        processService.withdraw(TENANT, inst1, USER);
        WfInstance withdrawn = instanceRepository.findById(inst1).orElseThrow();
        assertEquals(TaskflowStatus.Instance.WITHDRAWN, withdrawn.getStatus());
        FormRecord afterWithdraw = formRecordRepository.findById(recordId).orElseThrow();
        assertEquals(FormRecord.STATUS_SAVED, afterWithdraw.getStatus());
        assertNull(afterWithdraw.getCurrentInstanceId());

        values.put("amount", 2000);
        formRecordService.update(TENANT, recordId,
                new SaveFormRecordRequest("PUR_FORM", values, "标题2", USER, "测试人"), USER);
        assertEquals(0, new java.math.BigDecimal("2000").compareTo(
                purFormRepository.findById(afterWithdraw.getDataId()).orElseThrow().getAmount()));

        Long inst2 = formRecordService.startProcess(TENANT, recordId, new StartFormRecordProcessRequest(
                defCode, "BIZ-2", "标题2", (short) 2, null, USER, "测试人", null, null));
        assertNotNull(inst2);
        assertTrue(!inst1.equals(inst2));
        assertEquals(FormRecord.STATUS_IN_PROCESS,
                formRecordRepository.findById(recordId).orElseThrow().getStatus());
    }

    @Test
    @DisplayName("已有人同意后不可撤回")
    void cannotWithdrawAfterApprove() {
        String defCode = publishPurFlow();
        Map<String, Object> values = new LinkedHashMap<>();
        values.put("orderNo", "PO-X");
        values.put("amount", 1);
        Long recordId = formRecordService.create(TENANT, new SaveFormRecordRequest(
                "PUR_FORM", values, null, USER, "u"));
        Long instId = formRecordService.startProcess(TENANT, recordId, new StartFormRecordProcessRequest(
                defCode, "B1", "t", null, null, USER, "u", null, null));
        var pending = wfTaskRepository.findPendingByInstance(instId);
        assertEquals(1, pending.size());
        processService.completeTask(TENANT, pending.get(0).getId(),
                new CompleteWfTaskRequest("APPROVE", "ok"), APPROVER);

        // 流程可能已 COMPLETED（单级），撤回应失败
        BusinessException ex = assertThrows(BusinessException.class,
                () -> processService.withdraw(TENANT, instId, USER));
        assertTrue(ex.getMessage().contains("进行中") || ex.getMessage().contains("无人审批"));
    }
}
