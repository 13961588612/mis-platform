package com.mis.system.domain.entity;

import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/**
 * {@link MenuType} ↔ INTEGER 互转（数据库 sys_menu.type 为 SMALLINT）。
 */
@Converter(autoApply = false)
public class MenuTypeConverter implements AttributeConverter<MenuType, Integer> {

    @Override
    public Integer convertToDatabaseColumn(MenuType attribute) {
        return attribute == null ? null : attribute.getCode();
    }

    @Override
    public MenuType convertToEntityAttribute(Integer dbData) {
        return dbData == null ? null : MenuType.of(dbData);
    }
}
