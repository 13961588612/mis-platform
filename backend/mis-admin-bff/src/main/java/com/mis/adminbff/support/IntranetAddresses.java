package com.mis.adminbff.support;

import jakarta.servlet.http.HttpServletRequest;

import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.List;

/** 判断请求是否来自内网（RFC1918 / 回环 / ULA）。 */
public final class IntranetAddresses {

    private IntranetAddresses() {
    }

    public static boolean isIntranetClient(HttpServletRequest request, List<String> extraCidrs) {
        String ip = clientIp(request);
        return isIntranetIp(ip, extraCidrs);
    }

    public static String clientIp(HttpServletRequest request) {
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) {
            return forwarded.split(",")[0].trim();
        }
        String realIp = request.getHeader("X-Real-IP");
        if (realIp != null && !realIp.isBlank()) {
            return realIp.trim();
        }
        return request.getRemoteAddr();
    }

    public static boolean isIntranetIp(String ip, List<String> extraCidrs) {
        if (ip == null || ip.isBlank()) {
            return false;
        }
        String host = ip;
        if (host.startsWith("[") && host.endsWith("]")) {
            host = host.substring(1, host.length() - 1);
        }
        int pct = host.indexOf('%');
        if (pct > 0) {
            host = host.substring(0, pct);
        }
        InetAddress addr;
        try {
            addr = InetAddress.getByName(host);
        } catch (UnknownHostException e) {
            return false;
        }
        if (addr.isLoopbackAddress() || addr.isLinkLocalAddress() || addr.isSiteLocalAddress()) {
            return true;
        }
        byte[] bytes = addr.getAddress();
        if (bytes.length == 16) {
            // fc00::/7 unique local
            int b0 = bytes[0] & 0xff;
            if ((b0 & 0xfe) == 0xfc) {
                return true;
            }
        }
        if (extraCidrs != null) {
            for (String cidr : extraCidrs) {
                if (cidr != null && inCidr(addr, cidr.trim())) {
                    return true;
                }
            }
        }
        return false;
    }

    static boolean inCidr(InetAddress addr, String cidr) {
        int slash = cidr.indexOf('/');
        if (slash <= 0) {
            try {
                return addr.equals(InetAddress.getByName(cidr));
            } catch (UnknownHostException e) {
                return false;
            }
        }
        String network = cidr.substring(0, slash);
        int prefix;
        try {
            prefix = Integer.parseInt(cidr.substring(slash + 1));
        } catch (NumberFormatException e) {
            return false;
        }
        InetAddress netAddr;
        try {
            netAddr = InetAddress.getByName(network);
        } catch (UnknownHostException e) {
            return false;
        }
        byte[] a = addr.getAddress();
        byte[] n = netAddr.getAddress();
        if (a.length != n.length) {
            return false;
        }
        int max = a.length * 8;
        if (prefix < 0 || prefix > max) {
            return false;
        }
        int fullBytes = prefix / 8;
        int remain = prefix % 8;
        for (int i = 0; i < fullBytes; i++) {
            if (a[i] != n[i]) {
                return false;
            }
        }
        if (remain == 0) {
            return true;
        }
        int mask = 0xff << (8 - remain);
        return (a[fullBytes] & mask) == (n[fullBytes] & mask);
    }
}
