package com.mis.adminbff.controller;

import com.mis.adminbff.service.DictFacadeService;
import com.mis.common.core.result.Result;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
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
import java.util.Map;

@RestController
@RequestMapping("/api/v1/dicts")
public class DictController {

    private final DictFacadeService dictFacadeService;

    public DictController(DictFacadeService dictFacadeService) {
        this.dictFacadeService = dictFacadeService;
    }

    @GetMapping("/types")
    public Result<List<Map<String, Object>>> listTypes() {
        return Result.ok(dictFacadeService.listTypes());
    }

    @PostMapping("/types")
    public Result<Map<String, Object>> createType(@Valid @RequestBody DictTypeBody body) {
        return Result.ok(dictFacadeService.createType(body.code(), body.name(), body.remark()));
    }

    @PutMapping("/types/{id}")
    public Result<Map<String, Object>> updateType(@PathVariable Long id, @Valid @RequestBody DictTypeUpdateBody body) {
        return Result.ok(dictFacadeService.updateType(id, body.name(), body.status(), body.remark()));
    }

    @DeleteMapping("/types/{id}")
    public Result<Void> deleteType(@PathVariable Long id) {
        dictFacadeService.deleteType(id);
        return Result.ok();
    }

    @GetMapping("/items")
    public Result<List<Map<String, Object>>> listItems(@RequestParam Long typeId) {
        return Result.ok(dictFacadeService.listItems(typeId));
    }

    @PostMapping("/items")
    public Result<Map<String, Object>> createItem(@Valid @RequestBody DictItemBody body) {
        return Result.ok(dictFacadeService.createItem(
                body.typeId(), body.label(), body.value(), body.sort(), body.cssClass()));
    }

    @PutMapping("/items/{id}")
    public Result<Map<String, Object>> updateItem(@PathVariable Long id, @Valid @RequestBody DictItemUpdateBody body) {
        return Result.ok(dictFacadeService.updateItem(
                id, body.label(), body.value(), body.sort(), body.status(), body.cssClass()));
    }

    @DeleteMapping("/items/{id}")
    public Result<Void> deleteItem(@PathVariable Long id) {
        dictFacadeService.deleteItem(id);
        return Result.ok();
    }

    public record DictTypeBody(@NotBlank String code, @NotBlank String name, String remark) {}

    public record DictTypeUpdateBody(@NotBlank String name, Integer status, String remark) {}

    public record DictItemBody(
            @NotNull Long typeId,
            @NotBlank String label,
            @NotBlank String value,
            Integer sort,
            String cssClass) {}

    public record DictItemUpdateBody(
            @NotBlank String label,
            @NotBlank String value,
            Integer sort,
            Integer status,
            String cssClass) {}
}
