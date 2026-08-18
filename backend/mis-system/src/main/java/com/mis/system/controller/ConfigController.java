package com.mis.system.controller;

import com.mis.common.core.result.Result;
import com.mis.system.dto.ConfigCreateRequest;
import com.mis.system.dto.ConfigUpdateRequest;
import com.mis.system.dto.ConfigVO;
import com.mis.system.service.ConfigService;
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
@RequestMapping("/internal/v1/configs")
public class ConfigController {

    private final ConfigService configService;

    public ConfigController(ConfigService configService) {
        this.configService = configService;
    }

    @GetMapping
    public Result<List<ConfigVO>> list() {
        return Result.ok(configService.list());
    }

    @GetMapping("/{id}")
    public Result<ConfigVO> get(@PathVariable Long id) {
        return Result.ok(configService.getById(id));
    }

    @GetMapping("/key/{key}")
    public Result<ConfigVO> getByKey(@PathVariable String key) {
        return configService.getOptionalByKey(key).map(Result::ok).orElse(Result.ok(null));
    }

    @PostMapping
    public Result<ConfigVO> create(@Valid @RequestBody ConfigCreateRequest request) {
        return Result.ok(configService.create(request));
    }

    @PutMapping("/{id}")
    public Result<ConfigVO> update(@PathVariable Long id, @Valid @RequestBody ConfigUpdateRequest request) {
        return Result.ok(configService.update(id, request));
    }

    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable Long id) {
        configService.delete(id);
        return Result.ok();
    }
}
