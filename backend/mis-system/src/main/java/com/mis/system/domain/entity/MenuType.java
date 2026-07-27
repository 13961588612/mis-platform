package com.mis.system.domain.entity;

/**
 * 菜单节点类型（对齐 sys_menu.type：1 目录 / 2 菜单 / 3 按钮）。
 * <p>数据库以 SMALLINT 存储，通过 {@link MenuTypeConverter} 与枚举互转。</p>
 */
public enum MenuType {

    CATALOG(1),
    MENU(2),
    BUTTON(3);

    private final int code;

    MenuType(int code) {
        this.code = code;
    }

    public int getCode() {
        return code;
    }

    public static MenuType of(int code) {
        for (MenuType type : values()) {
            if (type.code == code) {
                return type;
            }
        }
        throw new IllegalArgumentException("未知菜单类型: " + code);
    }
}
