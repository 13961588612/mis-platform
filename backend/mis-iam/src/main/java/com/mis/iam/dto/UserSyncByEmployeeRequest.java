package com.mis.iam.dto;

import jakarta.validation.constraints.NotNull;

/** mis-org 员工变更后反向同步绑定用户（Req4） */
public record UserSyncByEmployeeRequest(
        @NotNull Long employeeId,
        /** 员工最新姓名（覆盖绑定用户）；为 null 时不改 */
        String realName,
        /** 员工最新手机；为 null 时不改 */
        String phone,
        /** 员工最新状态：0=停用（同步禁用用户），1=恢复（不自动恢复用户） */
        Integer status
) {}
