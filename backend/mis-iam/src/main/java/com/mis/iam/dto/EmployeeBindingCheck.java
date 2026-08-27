package com.mis.iam.dto;

/**
 * 员工绑定预检结果：该员工是否已在指定「租户 + APP」内被其他账号绑定（D1 守卫）。
 * <p>前端在「选择员工」即时调用，避免保存时才发现冲突；保存时后端再次兜底校验。</p>
 */
public record EmployeeBindingCheck(boolean exists) {}
