package com.mis.adminbff.controller;

import com.mis.adminbff.client.model.ConfigVO;
import com.mis.adminbff.dto.ConfigCreateRequest;
import com.mis.adminbff.dto.ConfigUpdateRequest;
import com.mis.adminbff.service.ConfigFacadeService;
import com.mis.common.core.result.Result;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/v1/configs")
public class ConfigController {

    private final ConfigFacadeService configFacadeService;

    public ConfigController(ConfigFacadeService configFacadeService) {
        this.configFacadeService = configFacadeService;
    }

    @GetMapping
    public Result<List<ConfigVO>> list() {
        return Result.ok(configFacadeService.listConfigs());
    }

    @GetMapping("/{id}")
    public Result<ConfigVO> get(@PathVariable Long id) {
        return Result.ok(configFacadeService.getConfig(id));
    }

    @PostMapping
    public Result<ConfigVO> create(@Valid @RequestBody ConfigCreateRequest request) {
        return Result.ok(configFacadeService.createConfig(request));
    }

    @PutMapping("/{id}")
    public Result<ConfigVO> update(@PathVariable Long id, @Valid @RequestBody ConfigUpdateRequest request) {
        return Result.ok(configFacadeService.updateConfig(id, request));
    }

    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable Long id) {
        configFacadeService.deleteConfig(id);
        return Result.ok();
    }
}
