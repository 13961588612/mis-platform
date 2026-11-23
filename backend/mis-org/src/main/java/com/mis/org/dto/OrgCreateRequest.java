package com.mis.org.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record OrgCreateRequest(
        @NotNull Long tenantId,
        @NotBlank String code,
        @NotBlank String name,
        /** V40 新增：上级组织（0=顶级；null 视为顶级） */
        Long parentId,
        Integer sort,
        String remark,
        /** 是否门店：0/1 */
        Integer isStore,
        /** 门店编号（is_store=1 必填） */
        String storeCode,
        /** 门店类型：BGMD/CSMD/WLZS（is_store=1 必填） */
        String storeType,
        /** 根部门类别；为空则取租户 headquarters 或首个启用类别 */
        Long categoryId
) {}
