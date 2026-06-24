package com.mis.common.security.context;

import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

/**
 * 当前请求的操作人员上下文（来自 Gateway JWT 透传头或 BFF 下游透传）。
 */
public class LoginUser {

    private Long userId;
    private Long tenantId;
    private Long appId;
    private Long employeeId;
    private String username;
    private Set<String> roles = Collections.emptySet();
    private Set<String> permissions = Collections.emptySet();

    public Long getUserId() {
        return userId;
    }

    public void setUserId(Long userId) {
        this.userId = userId;
    }

    public Long getTenantId() {
        return tenantId;
    }

    public void setTenantId(Long tenantId) {
        this.tenantId = tenantId;
    }

    public Long getAppId() {
        return appId;
    }

    public void setAppId(Long appId) {
        this.appId = appId;
    }

    public Long getEmployeeId() {
        return employeeId;
    }

    public void setEmployeeId(Long employeeId) {
        this.employeeId = employeeId;
    }

    public String getUsername() {
        return username;
    }

    public void setUsername(String username) {
        this.username = username;
    }

    public Set<String> getRoles() {
        return roles;
    }

    public void setRoles(Set<String> roles) {
        this.roles = roles != null ? new HashSet<>(roles) : Collections.emptySet();
    }

    public Set<String> getPermissions() {
        return permissions;
    }

    public void setPermissions(Set<String> permissions) {
        this.permissions = permissions != null ? new HashSet<>(permissions) : Collections.emptySet();
    }
}
