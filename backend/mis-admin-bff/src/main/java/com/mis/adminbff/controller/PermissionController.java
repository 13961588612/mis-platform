package com.mis.adminbff.controller;

import com.mis.adminbff.dto.StoreVO;
import com.mis.adminbff.service.PermissionQueryService;
import com.mis.common.core.result.Result;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 权限查询类接口（当前操作员数据范围）。
 */
@RestController
@RequestMapping("/api/v1/permissions")
public class PermissionController {

    private final PermissionQueryService permissionQueryService;

    public PermissionController(PermissionQueryService permissionQueryService) {
        this.permissionQueryService = permissionQueryService;
    }

    /**
     * 查询当前操作员权限内门店。
     *
     * @param storeType 可选门店类型：BGMD / CSMD / WLZS；不传则返回全部类型
     */
    @GetMapping("/stores")
    public Result<List<StoreVO>> myStores(
            @RequestParam(required = false) String storeType) {
        return Result.ok(permissionQueryService.listMyStores(storeType));
    }
}
