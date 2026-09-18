package com.mis.adminbff.client;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class BankReceiptClientPathTest {

    @Test
    void mapsPosAccountPrefixToAccountDecide() {
        assertEquals(
                "/api/account-decide/banks",
                BankReceiptClient.toDownstreamPath("/api/v1/finance/bank-account/pos-account/banks"));
        assertEquals(
                "/api/account-decide/terminals/query",
                BankReceiptClient.toDownstreamPath(
                        "/api/v1/finance/bank-account/pos-account/terminals/query"));
        assertEquals(
                "/api/account-decide",
                BankReceiptClient.toDownstreamPath("/api/v1/finance/bank-account/pos-account"));
    }

    @Test
    void rejectsForeignPath() {
        assertThrows(
                Exception.class,
                () -> BankReceiptClient.toDownstreamPath("/api/v1/kb/overview"));
    }
}
