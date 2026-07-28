package com.mis.iam.client;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.core.result.Result;
import com.mis.iam.config.IamProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * 调用 mis-org 校验员工主数据。
 */
@Component
public class OrgEmployeeClient {

    private static final Logger log = LoggerFactory.getLogger(OrgEmployeeClient.class);

    private final RestClient restClient;
    private final IamProperties iamProperties;

    public OrgEmployeeClient(
            @Qualifier("plainRestClientBuilder") RestClient.Builder plainRestClientBuilder,
            RestClient.Builder loadBalancedRestClientBuilder,
            IamProperties iamProperties) {
        this.iamProperties = iamProperties;
        RestClient.Builder builder = iamProperties.isOrgDiscoveryEnabled()
                ? loadBalancedRestClientBuilder
                : plainRestClientBuilder;
        this.restClient = builder.baseUrl(resolveBaseUrl(iamProperties)).build();
    }

    /**
     * 确认员工存在且属于指定租户；失败抛业务异常。
     */
    public void requireEmployee(Long tenantId, Long employeeId) {
        if (!iamProperties.isOrgCheckEnabled()) {
            return;
        }
        OrgEmployeeView employee = findEmployee(employeeId)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "员工不存在"));
        if (employee.tenantId() != null && !String.valueOf(tenantId).equals(String.valueOf(employee.tenantId()))) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "员工不属于该租户");
        }
    }

    /**
     * 按部门列出员工 ID；下游失败时返回空列表（调用方据此得到空页）。
     */
    public java.util.List<Long> listEmployeeIdsByDept(Long tenantId, Long deptId) {
        if (tenantId == null || deptId == null) {
            return java.util.List.of();
        }
        try {
            Result<java.util.List<OrgEmployeeView>> result = restClient.get()
                    .uri(uriBuilder -> uriBuilder
                            .path("/internal/v1/employees")
                            .queryParam("tenantId", tenantId)
                            .queryParam("deptId", deptId)
                            .build())
                    .retrieve()
                    .body(new ParameterizedTypeReference<Result<java.util.List<OrgEmployeeView>>>() {});
            if (result == null || !result.isSuccess() || result.getData() == null) {
                return java.util.List.of();
            }
            return result.getData().stream()
                    .map(OrgEmployeeView::id)
                    .filter(id -> id != null && !id.isBlank())
                    .map(Long::valueOf)
                    .toList();
        } catch (RestClientException | NumberFormatException ex) {
            log.warn("调用 mis-org 按部门查员工失败: tenantId={}, deptId={}", tenantId, deptId, ex);
            return java.util.List.of();
        }
    }

    /**
     * 查询员工（登录补全姓名等）；下游失败时返回 empty，不阻断主流程。
     */
    public java.util.Optional<OrgEmployeeView> findEmployee(Long employeeId) {
        if (employeeId == null) {
            return java.util.Optional.empty();
        }
        try {
            Result<OrgEmployeeView> result = restClient.get()
                    .uri("/internal/v1/employees/{id}", employeeId)
                    .retrieve()
                    .body(new ParameterizedTypeReference<Result<OrgEmployeeView>>() {});
            if (result == null || !result.isSuccess() || result.getData() == null) {
                return java.util.Optional.empty();
            }
            return java.util.Optional.of(result.getData());
        } catch (RestClientException ex) {
            log.warn("调用 mis-org 查询员工失败: employeeId={}", employeeId, ex);
            return java.util.Optional.empty();
        }
    }

    private static String resolveBaseUrl(IamProperties properties) {
        if (properties.isOrgDiscoveryEnabled()) {
            return "http://" + properties.getOrgServiceId();
        }
        return properties.getOrgBaseUrl();
    }
}
