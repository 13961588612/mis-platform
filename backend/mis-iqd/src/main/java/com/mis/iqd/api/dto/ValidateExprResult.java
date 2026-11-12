package com.mis.iqd.api.dto;

import java.util.ArrayList;
import java.util.List;

/**
 * 表达式静态校验出参（v1.11 §3.3 {@code GET /catalog/validate-expression}；snake_case wire）。
 *
 * <p>用于 MR-04 计算列 / MR-06 Cube measure expression 的**提交前同步校验**（A-10）：
 * 校验不通过即前端阻断保存；服务端落库时再校一次作为兜底（失败 → 42201）。
 */
public class ValidateExprResult {

    /** 是否通过校验。 */
    private boolean valid = true;

    /** 错误明细（人可读；空列表 = 通过）。 */
    private List<String> errors = new ArrayList<>();

    public ValidateExprResult() {
    }

    public ValidateExprResult(boolean valid, List<String> errors) {
        this.valid = valid;
        this.errors = errors == null ? new ArrayList<>() : errors;
    }

    public boolean isValid() {
        return valid;
    }

    public void setValid(boolean valid) {
        this.valid = valid;
    }

    public List<String> getErrors() {
        return errors;
    }

    public void setErrors(List<String> errors) {
        this.errors = errors == null ? new ArrayList<>() : errors;
    }
}
