package com.mis.adminbff.dto;

/** 当前操作员权限内门店（组织 is_store=1）。 */
public record StoreVO(
        String id,
        String storeCode,
        String name,
        /** BGMD / CSMD / WLZS */
        String storeType,
        Integer sort
) {}
