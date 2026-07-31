package com.mis.adminbff.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * ai-platform 反向调用信任配置（设计 §3 决策3 / §7.2 / §8.2）。
 *
 * <p>绑定 {@code mis.ai-platform.*} 段，供 {@link com.mis.adminbff.security.ReverseTrustInterceptor}
 * 校验「调用方是可信 ai-platform」并解析委托用户身份。复用既有 {@code @ConfigurationProperties(prefix =
 * "mis.ai-platform")}（与 {@link AiPlatformProperties} 并存，各自只读取自身字段，无冲突）。
 */
@Component
@ConfigurationProperties(prefix = "mis.ai-platform")
public class AiPlatformTrustConfig {

    /** 反向信任总开关；关闭后反向端点退化为仅依赖网关 PEP（不推荐生产开启）。 */
    private boolean reverseTrustEnabled = true;

    /** 因子一：与 ai-platform 共享的服务凭证（对应 design §8.2 的请求头 X-Platform-Token）。 */
    private String serviceToken = "";

    /**
     * 因子三：ai-platform 来源网段（CIDR，如 10.20.0.0/16）。
     * 为空表示不限制来源网络（仅靠 service-token 作为闸门，防御纵深降级）。
     */
    private String trustedNetwork = "";

    /** 因子二：委托 MIS JWT 的签发方（iss），默认 mis-platform。 */
    private String misJwtIssuer = "mis-platform";

    /** 因子二：用于验签 X-Mis-Upstream-Jwt 的 MIS RSA 公钥（PEM，含 BEGIN/END 包裹）。 */
    private String misJwtPublicKey = "";

    /** 单据写回目标微服务基址（DocWriteHandler 复用，对应 design §9.2.1）。 */
    private String docServiceBaseUrl = "";

    public boolean isReverseTrustEnabled() {
        return reverseTrustEnabled;
    }

    public void setReverseTrustEnabled(boolean reverseTrustEnabled) {
        this.reverseTrustEnabled = reverseTrustEnabled;
    }

    public String getServiceToken() {
        return serviceToken;
    }

    public void setServiceToken(String serviceToken) {
        this.serviceToken = serviceToken;
    }

    public String getTrustedNetwork() {
        return trustedNetwork;
    }

    public void setTrustedNetwork(String trustedNetwork) {
        this.trustedNetwork = trustedNetwork;
    }

    public String getMisJwtIssuer() {
        return misJwtIssuer;
    }

    public void setMisJwtIssuer(String misJwtIssuer) {
        this.misJwtIssuer = misJwtIssuer;
    }

    public String getMisJwtPublicKey() {
        return misJwtPublicKey;
    }

    public void setMisJwtPublicKey(String misJwtPublicKey) {
        this.misJwtPublicKey = misJwtPublicKey;
    }

    public String getDocServiceBaseUrl() {
        return docServiceBaseUrl;
    }

    public void setDocServiceBaseUrl(String docServiceBaseUrl) {
        this.docServiceBaseUrl = docServiceBaseUrl;
    }
}
