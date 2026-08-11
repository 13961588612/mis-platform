package com.mis.adminbff.security;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.nio.charset.StandardCharsets;

/**
 * 服务间信任校验的共享原语（常量时间比较 + IPv4 CIDR 归属判断）。
 *
 * <p>由 {@link ReverseTrustInterceptor}（反向调用双模式）与
 * {@link InternalServiceTrustInterceptor}（{@code /internal/**} 严格模式）共用。
 * 抽出来的唯一目的是<b>让两条闸门用同一份实现</b>：共享密钥比较一旦有一处退化成
 * {@code equals}，就等于给时序侧信道开了后门；CIDR 判断一旦有一处写歪，
 * 「信任域」就成了摆设。复制粘贴两份迟早会漂移。
 *
 * <p>本类只搬运既有实现，语义与原 {@code ReverseTrustInterceptor} 私有方法逐行等价。
 */
final class ServiceTrustSupport {

    private static final Logger log = LoggerFactory.getLogger(ServiceTrustSupport.class);

    private ServiceTrustSupport() {
    }

    /**
     * 常量时间比较，避免共享密钥被时序侧信道攻击。
     *
     * @param a 实际收到的凭证；可为 {@code null}
     * @param b 期望的凭证；可为 {@code null}
     * @return 两者非空且逐字节相等时返回 {@code true}
     */
    static boolean constantTimeEquals(String a, String b) {
        if (a == null || b == null) {
            return false;
        }
        byte[] ab = a.getBytes(StandardCharsets.UTF_8);
        byte[] bb = b.getBytes(StandardCharsets.UTF_8);
        int diff = ab.length ^ bb.length;
        int min = Math.min(ab.length, bb.length);
        for (int i = 0; i < min; i++) {
            diff |= (ab[i] ^ bb[i]);
        }
        return diff == 0;
    }

    /**
     * IPv4 CIDR 归属判断（仅支持 IPv4；IPv6 / 非法输入一律返回 {@code false}，即 fail-closed）。
     *
     * @param ip   来源 IP
     * @param cidr 信任网段，形如 {@code 10.20.0.0/16}
     * @return 命中信任网段返回 {@code true}
     */
    static boolean isInTrustedNetwork(String ip, String cidr) {
        try {
            String[] parts = cidr.split("/", 2);
            int maskBits = Integer.parseInt(parts[1].trim());
            long ipLong = ipToLong(ip);
            long netLong = ipToLong(parts[0].trim());
            if (ipLong < 0 || netLong < 0 || maskBits < 0 || maskBits > 32) {
                return false;
            }
            long mask = (maskBits == 0) ? 0L : (0xFFFFFFFFL << (32 - maskBits)) & 0xFFFFFFFFL;
            return (ipLong & mask) == (netLong & mask);
        } catch (Exception ex) {
            log.warn("信任域配置非法 cidr={}: {}", cidr, ex.getMessage());
            return false;
        }
    }

    /**
     * 点分十进制 IPv4 转无符号长整型。
     *
     * @param ip 点分十进制字符串
     * @return 转换结果；非 IPv4 / 非法输入返回 {@code -1}
     */
    private static long ipToLong(String ip) {
        if (ip == null || ip.contains(":")) {
            return -1; // 仅支持 IPv4
        }
        String[] octets = ip.trim().split("\\.");
        if (octets.length != 4) {
            return -1;
        }
        long result = 0;
        for (String octet : octets) {
            int v = Integer.parseInt(octet);
            if (v < 0 || v > 255) {
                return -1;
            }
            result = (result << 8) | v;
        }
        return result & 0xFFFFFFFFL;
    }
}
