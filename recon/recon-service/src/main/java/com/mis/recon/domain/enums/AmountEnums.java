package com.mis.recon.domain.enums;

import com.mis.recon.common.BizException;
import com.mis.recon.common.ErrorCode;

/**
 * 金额类枚举（F27）：常量名即 DDL 落库值（code=name，G18）。
 */
public final class AmountEnums {

    private AmountEnums() {
    }

    /** 金额单位（non_monetary 由补丁02 V33 引入） */
    public enum AmountUnit {
        yuan, point, non_monetary;

        public static AmountUnit from(String value) {
            return parse(AmountUnit.class, value, "yuan/point/non_monetary");
        }

        public String code() {
            return name();
        }
    }

    /** 金额角色 */
    public enum UnitRole {
        primary, aux;

        public static UnitRole from(String value) {
            return parse(UnitRole.class, value, "primary/aux");
        }

        public String code() {
            return name();
        }
    }

    /** 金额方向 */
    public enum AmountDirection {
        in, out, none;

        public static AmountDirection from(String value) {
            return parse(AmountDirection.class, value, "in/out/none");
        }

        public String code() {
            return name();
        }
    }

    private static <E extends Enum<E>> E parse(Class<E> type, String value, String legal) {
        if (value == null) {
            throw new BizException(ErrorCode.INVALID_ENUM_VALUE, type.getSimpleName() + " 不能为空");
        }
        try {
            return Enum.valueOf(type, value.trim());
        } catch (IllegalArgumentException e) {
            throw new BizException(ErrorCode.INVALID_ENUM_VALUE, type.getSimpleName() + " 非法: " + value + "，合法值: " + legal);
        }
    }
}
