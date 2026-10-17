package com.mis.adminbff.controller;

import com.mis.adminbff.client.TaskflowWebClient;
import com.mis.adminbff.client.model.FormRecordVO;
import com.mis.adminbff.support.TaskflowIdentity;
import com.mis.common.core.result.PageResult;
import com.mis.common.core.result.Result;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * 表单单据对外 API（BFF 透传）。
 */
@RestController
@RequestMapping("/api/v1/form-records")
public class FormRecordController {

    private final TaskflowWebClient taskflowWebClient;

    public FormRecordController(TaskflowWebClient taskflowWebClient) {
        this.taskflowWebClient = taskflowWebClient;
    }

    @GetMapping
    public Result<PageResult<FormRecordVO>> list(@RequestParam(required = false) Long tenantId,
                                                 @RequestParam(required = false) Long createdBy,
                                                 @RequestParam(required = false) String status,
                                                 @RequestParam(required = false) String formCode,
                                                 @RequestParam(defaultValue = "1") int page,
                                                 @RequestParam(defaultValue = "20") int size) {
        return Result.ok(taskflowWebClient.formRecords(
                TaskflowIdentity.tenantId(tenantId),
                TaskflowIdentity.userId(createdBy),
                status, formCode, page, size));
    }

    @GetMapping("/{id}")
    public Result<FormRecordVO> get(@PathVariable Long id,
                                    @RequestParam(required = false) Long tenantId,
                                    @RequestParam(required = false) Long viewerId) {
        return Result.ok(taskflowWebClient.formRecord(
                id, TaskflowIdentity.tenantId(tenantId), TaskflowIdentity.userId(viewerId)));
    }

    @PostMapping
    public Result<Long> create(@RequestParam(required = false) Long tenantId,
                               @RequestBody Map<String, Object> body) {
        Map<String, Object> payload = body == null ? Map.of() : new java.util.LinkedHashMap<>(body);
        if (payload.get("createdBy") == null) {
            payload.put("createdBy", TaskflowIdentity.userId(null));
        }
        return Result.ok(taskflowWebClient.createFormRecord(TaskflowIdentity.tenantId(tenantId), payload));
    }

    @PutMapping("/{id}")
    public Result<Void> update(@PathVariable Long id,
                               @RequestParam(required = false) Long tenantId,
                               @RequestParam(required = false) Long operatorId,
                               @RequestBody Map<String, Object> body) {
        taskflowWebClient.updateFormRecord(
                id, TaskflowIdentity.tenantId(tenantId), TaskflowIdentity.operatorId(operatorId), body);
        return Result.ok();
    }

    @PostMapping("/{id}/start-process")
    public Result<Long> startProcess(@PathVariable Long id,
                                     @RequestParam(required = false) Long tenantId,
                                     @RequestBody Map<String, Object> body) {
        Map<String, Object> payload = body == null ? new java.util.LinkedHashMap<>() : new java.util.LinkedHashMap<>(body);
        if (payload.get("initiatorId") == null) {
            payload.put("initiatorId", TaskflowIdentity.userId(null));
        }
        return Result.ok(taskflowWebClient.startFormRecordProcess(
                id, TaskflowIdentity.tenantId(tenantId), payload));
    }
}
