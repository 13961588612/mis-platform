package com.mis.adminbff.controller;

import com.mis.adminbff.dto.iqd.IqdConnectionConfigVO;
import com.mis.adminbff.dto.iqd.IqdConnectionSaveRequest;
import com.mis.adminbff.dto.iqd.IqdConnectionTestVO;
import com.mis.adminbff.service.iqd.IqdFacadeService;
import com.mis.common.core.result.Result;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 问数管理面代理（BFF → mis-iqd {@code /api/v1/iqd/**}）。
 *
 * <p>权限码（V69 sys_menu_api 绑定 + 兜底判权）：
 * <ul>
 *   <li>GET  /config       → {@code iqd:config:view}</li>
 *   <li>PUT  /config       → {@code iqd:config:save}</li>
 *   <li>POST /config/test  → {@code iqd:config:test}</li>
 * </ul>
 *
 * <p>密钥安全：GET 恒回 ******；PUT 提交非空才更新（占位符保留原值）。
 */
@RestController
@RequestMapping("/api/v1/iqd")
public class IqdController {

    private final IqdFacadeService iqdFacadeService;

    public IqdController(IqdFacadeService iqdFacadeService) {
        this.iqdFacadeService = iqdFacadeService;
    }

    /**
     * 取连接配置（密钥恒回 ******）。
     */
    @GetMapping("/config")
    public Result<IqdConnectionConfigVO> getConfig() {
        return Result.ok(iqdFacadeService.getConfig());
    }

    /**
     * 保存连接配置（upsert；密钥提交非空才更新）。
     */
    @PutMapping("/config")
    public Result<IqdConnectionConfigVO> saveConfig(@Valid @RequestBody IqdConnectionSaveRequest dto) {
        return Result.ok(iqdFacadeService.saveConfig(dto));
    }

    /**
     * 连通性自检：mis-iqd 侧 GET {baseUrl}/health 探活并更新 status。
     */
    @PostMapping("/config/test")
    public Result<IqdConnectionTestVO> testConfig() {
        return Result.ok(iqdFacadeService.testConfig());
    }
}
