package com.mis.system.controller;

import com.mis.common.core.result.Result;
import com.mis.system.dto.DictItemCreateRequest;
import com.mis.system.dto.DictItemUpdateRequest;
import com.mis.system.dto.DictItemVO;
import com.mis.system.dto.DictTypeCreateRequest;
import com.mis.system.dto.DictTypeUpdateRequest;
import com.mis.system.dto.DictTypeVO;
import com.mis.system.service.DictService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/internal/v1/dicts")
public class DictController {

    private final DictService dictService;

    public DictController(DictService dictService) {
        this.dictService = dictService;
    }

    @GetMapping("/types")
    public Result<List<DictTypeVO>> listTypes(@RequestParam Long tenantId) {
        return Result.ok(dictService.listTypes(tenantId));
    }

    @PostMapping("/types")
    public Result<DictTypeVO> createType(@Valid @RequestBody DictTypeCreateRequest request) {
        return Result.ok(dictService.createType(request));
    }

    @PutMapping("/types/{id}")
    public Result<DictTypeVO> updateType(@PathVariable Long id, @Valid @RequestBody DictTypeUpdateRequest request) {
        return Result.ok(dictService.updateType(id, request));
    }

    @DeleteMapping("/types/{id}")
    public Result<Void> deleteType(@PathVariable Long id) {
        dictService.deleteType(id);
        return Result.ok();
    }

    @GetMapping("/items")
    public Result<List<DictItemVO>> listItems(@RequestParam Long typeId) {
        return Result.ok(dictService.listItems(typeId));
    }

    @PostMapping("/items")
    public Result<DictItemVO> createItem(@Valid @RequestBody DictItemCreateRequest request) {
        return Result.ok(dictService.createItem(request));
    }

    @PutMapping("/items/{id}")
    public Result<DictItemVO> updateItem(@PathVariable Long id, @Valid @RequestBody DictItemUpdateRequest request) {
        return Result.ok(dictService.updateItem(id, request));
    }

    @DeleteMapping("/items/{id}")
    public Result<Void> deleteItem(@PathVariable Long id) {
        dictService.deleteItem(id);
        return Result.ok();
    }
}
