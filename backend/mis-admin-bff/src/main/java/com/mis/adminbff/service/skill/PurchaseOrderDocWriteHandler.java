package com.mis.adminbff.service.skill;

import com.mis.adminbff.config.AiPlatformTrustConfig;
import com.mis.common.core.constant.SecurityConstants;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.core.result.Result;
import com.mis.common.security.context.LoginUser;
import com.mis.common.security.context.SecurityContextHolder;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Consumer;

/**
 * 采购单（purchase-order）单据回填参考实现（设计 §4.4 / §9.2.1）。
 *
 * <p>路由键 {@code docType=purchase-order}。写动作复用 BFF 既有微服务连通性：以 WebClient 调目标
 * 单据微服务，并透传 {@code SecurityContextHolder} 中由反向信任注入的操作人身份
 * （X-User-Id / X-Tenant-Id 等），供目标微服务做 DataScope / 操作人校验——与
 * {@code AbstractDownstreamClient.loginContextHeaders()} 同构。
 *
 * <p><b>P0 参考骨架</b>：目标采购单微服务接口与字段映射（docType→fieldMapping）在 P0 尚未确权
 * （design §9.2.1），故确切端点/字段映射以清晰 TODO 标注；当前实现可编译、路由完整，且未配置目标
 * 基址时返回明确错误而非静默成功。待产品确认后补全真实端点与字段映射（P1-6 即开即用）。
 */
@Component
public class PurchaseOrderDocWriteHandler implements DocWriteHandler {

    private static final String DOC_TYPE = "purchase-order";
    private static final long DEFAULT_TIMEOUT_MS = 5000L;

    private final WebClient webClient;
    private final long timeoutMs = DEFAULT_TIMEOUT_MS;

    public PurchaseOrderDocWriteHandler(
            @Qualifier("plainWebClientBuilder") WebClient.Builder plainBuilder,
            AiPlatformTrustConfig trustConfig) {
        String baseUrl = trustConfig.getDocServiceBaseUrl();
        if (baseUrl != null && !baseUrl.isBlank()) {
            this.webClient = plainBuilder.baseUrl(baseUrl).build();
        } else {
            // 目标微服务尚未确权：延迟到 apply 时返回明确错误。
            this.webClient = null;
        }
    }

    @Override
    public boolean supports(String docType) {
        return DOC_TYPE.equalsIgnoreCase(docType);
    }

    @Override
    public DocWriteResult apply(String skillId, String docType, String docId, Map<String, Object> values) {
        if (docId == null || docId.isBlank()) {
            return DocWriteResult.error(docId, "docId 不能为空");
        }
        if (this.webClient == null) {
            // P0 参考骨架：目标微服务尚未确权，返回明确错误而非静默成功。
            return DocWriteResult.error(
                    docId, "采购单写回服务未配置（待确权目标微服务与字段映射，见设计 §9.2.1）");
        }
        try {
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("docId", docId);
            body.put("docType", docType);
            body.put("values", values == null ? Map.of() : values);
            // TODO(P0→P1-6): 替换为产品确权的采购单回填端点与字段映射（docType→fieldMapping）。
            Mono<Result<Void>> mono = webClient.put()
                    .uri("/internal/v1/purchase-orders/{docId}/fill", docId)
                    .headers(operatorHeaders())
                    .contentType(MediaType.APPLICATION_JSON)
                    .bodyValue(body)
                    .retrieve()
                    .bodyToMono(new ParameterizedTypeReference<Result<Void>>() {});
            block(mono);
            return DocWriteResult.success(docId, "采购单已回填");
        } catch (BusinessException ex) {
            return DocWriteResult.error(docId, "采购单写回失败: " + ex.getMessage());
        } catch (Exception ex) {
            return DocWriteResult.error(docId, "采购单写回异常: " + ex.getMessage());
        }
    }

    private <T> T block(Mono<Result<T>> mono) {
        Result<T> result = mono.block(Duration.ofMillis(timeoutMs));
        if (result == null) {
            throw new BusinessException(ResultCode.INTERNAL_ERROR, "下游无响应");
        }
        if (!result.isSuccess()) {
            throw new BusinessException(result.getCode(), result.getMessage());
        }
        return result.getData();
    }

    /** 透传操作人身份（镜像 AbstractDownstreamClient.loginContextHeaders()）。 */
    private Consumer<HttpHeaders> operatorHeaders() {
        return headers -> {
            LoginUser user = SecurityContextHolder.getOptional().orElse(null);
            if (user == null) {
                return;
            }
            if (user.getUserId() != null) {
                headers.set(SecurityConstants.HEADER_USER_ID, String.valueOf(user.getUserId()));
            }
            if (user.getTenantId() != null) {
                headers.set(SecurityConstants.HEADER_TENANT_ID, String.valueOf(user.getTenantId()));
            }
            if (user.getAppId() != null) {
                headers.set(SecurityConstants.HEADER_APP_ID, String.valueOf(user.getAppId()));
            }
            if (user.getEmployeeId() != null) {
                headers.set(SecurityConstants.HEADER_EMPLOYEE_ID, String.valueOf(user.getEmployeeId()));
            }
            if (user.getUsername() != null) {
                headers.set(SecurityConstants.HEADER_USERNAME, user.getUsername());
            }
        };
    }
}
