package com.mis.org.controller;

import com.mis.common.core.result.Result;
import com.mis.org.domain.entity.SysDeptCategory;
import com.mis.org.domain.repository.SysDeptCategoryRepository;
import com.mis.org.dto.DeptCategoryVO;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/internal/v1/dept-categories")
public class DeptCategoryController {

    private final SysDeptCategoryRepository categoryRepository;

    public DeptCategoryController(SysDeptCategoryRepository categoryRepository) {
        this.categoryRepository = categoryRepository;
    }

    @GetMapping
    public Result<List<DeptCategoryVO>> list(@RequestParam Long tenantId) {
        List<DeptCategoryVO> list = categoryRepository.findByTenantIdAndStatus(tenantId, 1).stream()
                .map(this::toVo)
                .toList();
        return Result.ok(list);
    }

    private DeptCategoryVO toVo(SysDeptCategory c) {
        return new DeptCategoryVO(
                String.valueOf(c.getId()),
                String.valueOf(c.getTenantId()),
                c.getCode(),
                c.getName(),
                c.getSort(),
                c.getStatus());
    }
}
