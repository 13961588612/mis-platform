package com.mis.org.controller;

import com.mis.common.core.result.Result;
import com.mis.org.service.MessageAudienceService;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 消息圈人内部接口：部门与岗位类型解析为员工。
 */
@RestController
@RequestMapping("/internal/v1/audience")
public class MessageAudienceController {

    private final MessageAudienceService audienceService;

    public MessageAudienceController(MessageAudienceService audienceService) {
        this.audienceService = audienceService;
    }

    @PostMapping("/employees")
    public Result<List<Long>> employees(@RequestBody AudienceEmployeeRequest request) {
        return Result.ok(audienceService.employeeIds(request.tenantId(), request.deptIds(), request.postTypeIds()));
    }

    public record AudienceEmployeeRequest(Long tenantId, List<Long> deptIds, List<Long> postTypeIds) {
    }
}
