package com.mis.adminbff.service;

import com.mis.adminbff.client.OrgWebClient;
import com.mis.adminbff.client.model.DeptVO;
import com.mis.adminbff.client.model.EmployeeVO;
import com.mis.adminbff.client.model.OrgVO;
import com.mis.adminbff.dto.DeptCreateRequest;
import com.mis.adminbff.dto.DeptUpdateRequest;
import com.mis.adminbff.dto.OrgCreateRequest;
import com.mis.adminbff.dto.OrgUpdateRequest;
import com.mis.adminbff.support.RequestContext;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
public class OrgFacadeService {

    private final OrgWebClient orgWebClient;

    public OrgFacadeService(OrgWebClient orgWebClient) {
        this.orgWebClient = orgWebClient;
    }

    public List<OrgVO> listOrgs() {
        return orgWebClient.listOrgs(RequestContext.requireTenantId());
    }

    public OrgVO getOrg(Long id) {
        return orgWebClient.getOrg(id);
    }

    public OrgVO createOrg(OrgCreateRequest request) {
        Map<String, Object> body = new HashMap<>();
        body.put("tenantId", RequestContext.requireTenantId());
        body.put("code", request.code());
        body.put("name", request.name());
        body.put("sort", request.sort());
        body.put("remark", request.remark());
        body.put("categoryId", request.categoryId());
        return orgWebClient.createOrg(body);
    }

    public OrgVO updateOrg(Long id, OrgUpdateRequest request) {
        Map<String, Object> body = new HashMap<>();
        body.put("name", request.name());
        body.put("sort", request.sort());
        body.put("status", request.status());
        body.put("remark", request.remark());
        return orgWebClient.updateOrg(id, body);
    }

    public void deleteOrg(Long id) {
        orgWebClient.deleteOrg(id);
    }

    public List<DeptVO> deptTree(Long orgId) {
        return orgWebClient.deptTree(orgId);
    }

    public DeptVO getDept(Long id) {
        return orgWebClient.getDept(id);
    }

    public DeptVO createDept(DeptCreateRequest request) {
        Map<String, Object> body = new HashMap<>();
        body.put("tenantId", RequestContext.requireTenantId());
        body.put("orgId", request.orgId());
        body.put("parentId", request.parentId());
        body.put("name", request.name());
        body.put("categoryId", request.categoryId());
        body.put("sort", request.sort());
        body.put("leaderEmployeeId", request.leaderEmployeeId());
        return orgWebClient.createDept(body);
    }

    public DeptVO updateDept(Long id, DeptUpdateRequest request) {
        Map<String, Object> body = new HashMap<>();
        body.put("name", request.name());
        body.put("categoryId", request.categoryId());
        body.put("parentId", request.parentId());
        body.put("sort", request.sort());
        body.put("status", request.status());
        body.put("leaderEmployeeId", request.leaderEmployeeId());
        return orgWebClient.updateDept(id, body);
    }

    public void deleteDept(Long id) {
        orgWebClient.deleteDept(id);
    }

    public List<EmployeeVO> listEmployees(Long deptId) {
        return orgWebClient.listEmployeesByDept(RequestContext.requireTenantId(), deptId);
    }
}
