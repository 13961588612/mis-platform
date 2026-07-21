package com.mis.adminbff.client;

import com.mis.adminbff.client.model.DeptVO;
import com.mis.adminbff.client.model.EmployeeVO;
import com.mis.adminbff.client.model.OrgVO;
import com.mis.adminbff.config.BffProperties;
import com.mis.common.core.result.Result;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.util.UriComponentsBuilder;
import reactor.core.publisher.Mono;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Component
public class OrgWebClient extends AbstractDownstreamClient {

    private static final ParameterizedTypeReference<Result<List<OrgVO>>> ORG_LIST =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<OrgVO>> ORG =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<Map<Long, String>>> NAME_MAP =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<List<DeptVO>>> DEPT_LIST =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<DeptVO>> DEPT =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<List<EmployeeVO>>> EMP_LIST =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<EmployeeVO>> EMP =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<Void>> VOID =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<Map<String, Long>>> COUNT =
            new ParameterizedTypeReference<>() {};

    public OrgWebClient(
            @Qualifier("plainWebClientBuilder") WebClient.Builder plainBuilder,
            @Qualifier("loadBalancedWebClientBuilder") WebClient.Builder loadBalancedBuilder,
            BffProperties properties) {
        super(buildClient(plainBuilder, loadBalancedBuilder, properties), properties.getAggregateTimeoutMs());
    }

    private static WebClient buildClient(
            WebClient.Builder plainBuilder,
            WebClient.Builder loadBalancedBuilder,
            BffProperties properties) {
        WebClient.Builder builder = properties.isOrgDiscoveryEnabled() ? loadBalancedBuilder : plainBuilder;
        return builder.baseUrl(resolveBaseUrl(
                properties.isOrgDiscoveryEnabled(),
                properties.getOrgServiceId(),
                properties.getOrgBaseUrl())).build();
    }

    public List<OrgVO> listOrgs(Long tenantId) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/orgs")
                .queryParam("tenantId", tenantId)
                .build(true)
                .toUriString();
        return block(client().get().uri(uri).retrieve().bodyToMono(ORG_LIST));
    }

    public long orgCount(Long tenantId) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/stats/orgs")
                .queryParam("tenantId", tenantId)
                .build(true)
                .toUriString();
        Map<String, Long> data = block(client().get().uri(uri).retrieve().bodyToMono(COUNT));
        return data != null && data.get("count") != null ? data.get("count") : 0L;
    }

    public Map<Long, String> orgNames(List<Long> ids) {
        if (ids == null || ids.isEmpty()) {
            return Map.of();
        }
        String idsParam = ids.stream().map(String::valueOf).collect(Collectors.joining(","));
        String uri = UriComponentsBuilder.fromPath("/internal/v1/orgs/names")
                .queryParam("ids", idsParam)
                .build(true)
                .toUriString();
        Map<Long, String> data = block(client().get().uri(uri).retrieve().bodyToMono(NAME_MAP));
        return data != null ? data : Map.of();
    }

    public OrgVO getOrg(Long id) {
        return block(client().get().uri("/internal/v1/orgs/{id}", id).retrieve().bodyToMono(ORG));
    }

    public OrgVO createOrg(Map<String, Object> body) {
        return block(post(body, ORG, "/internal/v1/orgs"));
    }

    public OrgVO updateOrg(Long id, Map<String, Object> body) {
        return block(put(body, ORG, "/internal/v1/orgs/{id}", id));
    }

    public void deleteOrg(Long id) {
        blockVoid(delete("/internal/v1/orgs/{id}", id));
    }

    public List<DeptVO> deptTree(Long orgId) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/depts/tree")
                .queryParam("orgId", orgId)
                .build(true)
                .toUriString();
        return block(client().get().uri(uri).retrieve().bodyToMono(DEPT_LIST));
    }

    public DeptVO getDept(Long id) {
        return block(client().get().uri("/internal/v1/depts/{id}", id).retrieve().bodyToMono(DEPT));
    }

    public Mono<Result<DeptVO>> getDeptMono(Long id) {
        return client().get().uri("/internal/v1/depts/{id}", id).retrieve().bodyToMono(DEPT);
    }

    public DeptVO createDept(Map<String, Object> body) {
        return block(post(body, DEPT, "/internal/v1/depts"));
    }

    public DeptVO updateDept(Long id, Map<String, Object> body) {
        return block(put(body, DEPT, "/internal/v1/depts/{id}", id));
    }

    public void deleteDept(Long id) {
        blockVoid(delete("/internal/v1/depts/{id}", id));
    }

    public List<EmployeeVO> listEmployeesByDept(Long tenantId, Long deptId) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/employees")
                .queryParam("tenantId", tenantId)
                .queryParam("deptId", deptId)
                .build(true)
                .toUriString();
        return block(client().get().uri(uri).headers(loginContextHeaders()).retrieve().bodyToMono(EMP_LIST));
    }

    public Map<Long, String> employeeNames(List<Long> ids) {
        if (ids == null || ids.isEmpty()) {
            return Map.of();
        }
        String idsParam = ids.stream().map(String::valueOf).collect(Collectors.joining(","));
        String uri = UriComponentsBuilder.fromPath("/internal/v1/employees/names")
                .queryParam("ids", idsParam)
                .build(true)
                .toUriString();
        Map<Long, String> data = block(client().get().uri(uri).retrieve().bodyToMono(NAME_MAP));
        return data != null ? data : Map.of();
    }

    public EmployeeVO getEmployee(Long id) {
        return block(client().get().uri("/internal/v1/employees/{id}", id).retrieve().bodyToMono(EMP));
    }

    public Mono<Result<EmployeeVO>> getEmployeeMono(Long id) {
        return client().get().uri("/internal/v1/employees/{id}", id).retrieve().bodyToMono(EMP);
    }

    public EmployeeVO createEmployee(Map<String, Object> body) {
        return block(post(body, EMP, "/internal/v1/employees"));
    }

    public EmployeeVO updateEmployee(Long id, Map<String, Object> body) {
        return block(put(body, EMP, "/internal/v1/employees/{id}", id));
    }

    public void deleteEmployee(Long id) {
        blockVoid(delete("/internal/v1/employees/{id}", id));
    }

    public static Map<String, Object> employeeCreateBody(
            Long tenantId, Long deptId, String employeeNo, String realName, String email, String phone) {
        Map<String, Object> body = new HashMap<>();
        body.put("tenantId", tenantId);
        body.put("deptId", deptId);
        body.put("employeeNo", employeeNo);
        body.put("realName", realName);
        body.put("email", email);
        body.put("phone", phone);
        return body;
    }
}
