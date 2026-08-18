package com.mis.org.client;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.core.result.Result;
import com.mis.org.config.OrgProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import java.util.Map;

/**
 * 反向调用 mis-iam：员工变更后同步绑定用户（Req4）。
 * 与 {@link IamDataScopeClient} 方向相反，但 baseUrl/发现 机制一致。
 */
@Component
public class OrgIamClient {

    private static final Logger log = LoggerFactory.getLogger(OrgIamClient.class);

    private final RestClient restClient;

    public OrgIamClient(
            @Qualifier("plainRestClientBuilder") RestClient.Builder plainBuilder,
            RestClient.Builder loadBalancedBuilder,
            OrgProperties properties) {
        RestClient.Builder builder = properties.isIamDiscoveryEnabled() ? loadBalancedBuilder : plainBuilder;
        String baseUrl = properties.isIamDiscoveryEnabled()
                ? "http://" + properties.getIamServiceId()
                : properties.getIamBaseUrl();
        this.restClient = builder.baseUrl(baseUrl).build();
    }

    /**
     * 通知 IAM：员工 {@code employeeId} 的 realName/phone/status 已变更。
     * status=0 时 IAM 会同步禁用绑定用户；status=1 时不自动恢复（需手工）。
     * 调用失败仅告警，不阻断员工主流程（员工保存优先）。
     */
    public void syncByEmployee(Long employeeId, String realName, String phone, Integer status) {
        try {
            Result<Void> result = restClient.post()
                    .uri("/internal/v1/users/sync-by-employee")
                    .body(Map.of(
                            "employeeId", employeeId,
                            "realName", realName,
                            "phone", phone,
                            "status", status))
                    .retrieve()
                    .body(new ParameterizedTypeReference<Result<Void>>() {});
            if (result == null || !result.isSuccess()) {
                log.warn("同步绑定用户失败(employeeId={}): {}", employeeId, result != null ? result.getMessage() : "null");
            }
        } catch (RestClientException ex) {
            log.warn("调用 mis-iam 同步绑定用户失败: employeeId={}", employeeId, ex);
        }
    }
}
