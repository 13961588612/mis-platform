package com.mis.taskflow.controller;

import com.mis.common.core.result.PageResult;
import com.mis.common.core.result.Result;
import com.mis.taskflow.dto.FormRecordVO;
import com.mis.taskflow.dto.SaveFormRecordRequest;
import com.mis.taskflow.dto.StartFormRecordProcessRequest;
import com.mis.taskflow.service.FormRecordService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 表单单据内部 API。
 */
@RestController
@RequestMapping("/internal/v1/form-records")
public class FormRecordController {

    private final FormRecordService formRecordService;

    public FormRecordController(FormRecordService formRecordService) {
        this.formRecordService = formRecordService;
    }

    @GetMapping
    public Result<PageResult<FormRecordVO>> list(@RequestParam Long tenantId,
                                                 @RequestParam Long createdBy,
                                                 @RequestParam(required = false) String status,
                                                 @RequestParam(required = false) String formCode,
                                                 @RequestParam(defaultValue = "1") int page,
                                                 @RequestParam(defaultValue = "20") int size) {
        return Result.ok(formRecordService.listMine(tenantId, createdBy, status, formCode, page, size));
    }

    @GetMapping("/{id}")
    public Result<FormRecordVO> get(@PathVariable Long id,
                                    @RequestParam Long tenantId,
                                    @RequestParam(required = false) Long viewerId) {
        return Result.ok(formRecordService.get(tenantId, id, viewerId));
    }

    @PostMapping
    public Result<Long> create(@RequestParam Long tenantId,
                               @Valid @RequestBody SaveFormRecordRequest request) {
        return Result.ok(formRecordService.create(tenantId, request));
    }

    @PutMapping("/{id}")
    public Result<Void> update(@PathVariable Long id,
                               @RequestParam Long tenantId,
                               @RequestParam(required = false) Long operatorId,
                               @Valid @RequestBody SaveFormRecordRequest request) {
        formRecordService.update(tenantId, id, request, operatorId);
        return Result.ok();
    }

    @PostMapping("/{id}/start-process")
    public Result<Long> startProcess(@PathVariable Long id,
                                     @RequestParam Long tenantId,
                                     @Valid @RequestBody StartFormRecordProcessRequest request) {
        return Result.ok(formRecordService.startProcess(tenantId, id, request));
    }
}
