package com.mis.org.controller;

import com.mis.common.core.result.Result;
import com.mis.org.dto.EmployeeCreateRequest;
import com.mis.org.dto.EmployeeUpdateRequest;
import com.mis.org.dto.EmployeeVO;
import com.mis.org.service.EmployeeService;
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

import java.util.Arrays;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/internal/v1/employees")
public class EmployeeController {

    private final EmployeeService employeeService;

    public EmployeeController(EmployeeService employeeService) {
        this.employeeService = employeeService;
    }

    @GetMapping
    public Result<List<EmployeeVO>> listByDept(@RequestParam Long tenantId, @RequestParam Long deptId) {
        return Result.ok(employeeService.listByDept(tenantId, deptId));
    }

    @GetMapping("/names")
    public Result<Map<Long, String>> names(@RequestParam String ids) {
        List<Long> idList = Arrays.stream(ids.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .map(Long::valueOf)
                .toList();
        return Result.ok(employeeService.namesByIds(idList));
    }

    @GetMapping("/{id}")
    public Result<EmployeeVO> get(@PathVariable Long id) {
        return Result.ok(employeeService.getById(id));
    }

    @PostMapping
    public Result<EmployeeVO> create(@Valid @RequestBody EmployeeCreateRequest request) {
        return Result.ok(employeeService.create(request));
    }

    @PutMapping("/{id}")
    public Result<EmployeeVO> update(@PathVariable Long id, @Valid @RequestBody EmployeeUpdateRequest request) {
        return Result.ok(employeeService.update(id, request));
    }

    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable Long id) {
        employeeService.delete(id);
        return Result.ok();
    }
}
