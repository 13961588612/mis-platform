package com.mis.adminbff.service;

import com.mis.adminbff.client.IamWebClient;
import com.mis.adminbff.client.model.IamRoleVO;
import com.mis.adminbff.client.model.RoleDataScopeVO;
import com.mis.adminbff.dto.RoleCreateRequest;
import com.mis.adminbff.dto.RoleDataScopeRequest;
import com.mis.adminbff.dto.RoleMenuAssignRequest;
import com.mis.adminbff.dto.RoleUpdateRequest;
import com.mis.adminbff.support.RequestContext;
import com.mis.common.core.result.PageResult;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
public class RoleFacadeService {

    private final IamWebClient iamWebClient;

    public RoleFacadeService(IamWebClient iamWebClient) {
        this.iamWebClient = iamWebClient;
    }

    public PageResult<IamRoleVO> page(int page, int size) {
        return iamWebClient.pageRoles(RequestContext.requireTenantId(), RequestContext.requireAppId(), page, size);
    }

    public List<IamRoleVO> listEnabled() {
        return iamWebClient.listEnabledRoles(RequestContext.requireTenantId(), RequestContext.requireAppId());
    }

    public IamRoleVO get(Long id) {
        return iamWebClient.getRole(id);
    }

    public IamRoleVO create(RoleCreateRequest request) {
        Map<String, Object> body = new HashMap<>();
        body.put("tenantId", RequestContext.requireTenantId());
        body.put("appId", RequestContext.requireAppId());
        body.put("code", request.code());
        body.put("name", request.name());
        body.put("dataScope", request.dataScope());
        body.put("remark", request.remark());
        return iamWebClient.createRole(body);
    }

    public IamRoleVO update(Long id, RoleUpdateRequest request) {
        Map<String, Object> body = new HashMap<>();
        body.put("name", request.name());
        body.put("dataScope", request.dataScope());
        body.put("status", request.status());
        body.put("remark", request.remark());
        return iamWebClient.updateRole(id, body);
    }

    public void delete(Long id) {
        iamWebClient.deleteRole(id);
    }

    public List<Long> listMenus(Long roleId) {
        return iamWebClient.listRoleMenus(roleId);
    }

    public void assignMenus(Long roleId, RoleMenuAssignRequest request) {
        iamWebClient.assignRoleMenus(roleId, request.menuIds());
    }

    public RoleDataScopeVO getDataScope(Long roleId) {
        return iamWebClient.getRoleDataScope(roleId);
    }

    public RoleDataScopeVO assignDataScope(Long roleId, RoleDataScopeRequest request) {
        return iamWebClient.assignRoleDataScope(
                roleId, request.dataScope(), request.orgIds(), request.deptIds());
    }
}
