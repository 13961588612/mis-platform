package com.mis.recon.controller;

import com.mis.recon.common.ApiResponse;
import com.mis.recon.common.BizException;
import com.mis.recon.common.ErrorCode;
import com.mis.recon.common.PageResult;
import com.mis.recon.custom.CustomCheckExecutor;
import com.mis.recon.custom.CustomComparator;
import com.mis.recon.custom.CustomMatcher;
import com.mis.recon.domain.config.ReconCheck;
import com.mis.recon.domain.dto.CheckDetailResp;
import com.mis.recon.domain.dto.CheckSaveReq;
import com.mis.recon.domain.dto.CustomClassValidateReq;
import com.mis.recon.service.config.CheckService;
import com.mis.recon.service.engine.CustomLoader;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.DeleteMapping;
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
 * 检查配置端点（F116）。复合键定位 {scenarioCode}/{checkName}（G9），check_name 创建后禁改（5002）。
 */
@RestController
@RequestMapping("/internal/v1/recon/checks")
@RequiredArgsConstructor
public class CheckController {

    private final CheckService checkService;
    private final CustomLoader customLoader;

    @GetMapping
    public ApiResponse<PageResult<ReconCheck>> page(
            @RequestParam String scenarioCode,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) Integer enabled) {
        return ApiResponse.ok(checkService.page(scenarioCode, PageSupport.normalize(page, size), keyword, enabled));
    }

    @GetMapping("/{scenarioCode}/{checkName}")
    public ApiResponse<CheckDetailResp> get(@PathVariable String scenarioCode,
                                            @PathVariable String checkName) {
        return ApiResponse.ok(checkService.get(scenarioCode, checkName));
    }

    /** 自定义类名实时校验（需求 §3.4.1）：类可加载 + 实现对应接口；不通过抛 6215/6216 */
    @PostMapping("/validate-custom-class")
    public ApiResponse<Map<String, Object>> validateCustomClass(@RequestBody(required = false) CustomClassValidateReq req) {
        String checkType = req == null ? null : req.getCheckType();
        String className = req == null ? null : req.getClassName();
        if (!StringUtils.hasText(className)) {
            throw new BizException(ErrorCode.CUSTOM_CLASS_BLANK, "自定义类名必填");
        }
        if (!StringUtils.hasText(checkType)) {
            throw new BizException(ErrorCode.PARAM_ERROR, "校验目标 checkType 必填（custom / custom_check / custom_compare）");
        }
        Class<?> required = switch (checkType) {
            case "custom" -> CustomMatcher.class;
            case "custom_check" -> CustomCheckExecutor.class;
            case "custom_compare" -> CustomComparator.class;
            default -> throw new BizException(ErrorCode.PARAM_ERROR, "未知校验目标 checkType：" + checkType);
        };
        customLoader.validate(className, required);
        return ApiResponse.ok(Map.of(
                "ok", true,
                "className", customLoader.resolveClassName(className)));
    }

    @PostMapping
    public ApiResponse<ReconCheck> create(@Valid @RequestBody CheckSaveReq req) {
        return ApiResponse.ok(checkService.saveCheck(req));
    }

    @PutMapping("/{scenarioCode}/{checkName}")
    public ApiResponse<ReconCheck> update(@PathVariable String scenarioCode,
                                          @PathVariable String checkName,
                                          @Valid @RequestBody CheckSaveReq req) {
        return ApiResponse.ok(checkService.updateCheck(scenarioCode, checkName, req));
    }

    @DeleteMapping("/{scenarioCode}/{checkName}")
    public ApiResponse<Void> delete(@PathVariable String scenarioCode, @PathVariable String checkName) {
        checkService.deleteCheck(scenarioCode, checkName);
        return ApiResponse.ok();
    }
}
