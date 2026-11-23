package com.mis.adminbff.support;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class IntranetAddressesTest {

    @Test
    void loopbackAndRfc1918AreIntranet() {
        assertTrue(IntranetAddresses.isIntranetIp("127.0.0.1", List.of()));
        assertTrue(IntranetAddresses.isIntranetIp("10.1.2.3", List.of()));
        assertTrue(IntranetAddresses.isIntranetIp("192.168.1.8", List.of()));
        assertTrue(IntranetAddresses.isIntranetIp("172.16.0.1", List.of()));
        assertTrue(IntranetAddresses.isIntranetIp("::1", List.of()));
    }

    @Test
    void publicIpRejectedUnlessExtraCidr() {
        assertFalse(IntranetAddresses.isIntranetIp("8.8.8.8", List.of()));
        assertTrue(IntranetAddresses.isIntranetIp("8.8.8.8", List.of("8.8.8.0/24")));
    }
}
