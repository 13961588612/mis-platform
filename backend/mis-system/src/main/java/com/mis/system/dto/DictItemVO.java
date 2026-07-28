package com.mis.system.dto;

public record DictItemVO(
        String id,
        String typeId,
        String label,
        String value,
        Integer sort,
        Integer status,
        String cssClass
) {}
