package com.mis.aireport.domain.param;

import com.mis.aireport.client.IamUserClient;
import com.mis.aireport.datasource.spm.bigdata.SpmSlotFetchService;
import com.mis.aireport.datasource.spm.bigdata.SpmSlotOption;
import com.mis.aireport.domain.entity.AiParamSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class AuthStoreSourceHandlerTest {

    private SpmSlotFetchService slots;
    private IamUserClient iam;
    private AuthStoreSourceHandler handler;
    private AiParamSource source;

    @BeforeEach
    void setUp() {
        slots = mock(SpmSlotFetchService.class);
        iam = mock(IamUserClient.class);
        handler = new AuthStoreSourceHandler(slots, iam);
        source = new AiParamSource();
        source.setSourceCode("spm_auth_store");
        source.setValueType("store");
        source.setWireKey("spmStoreId");
        source.setName("超市权限门店");
    }

    @Test
    void usesPermissionListWhenPresent() {
        when(slots.fetchAuthorizedStores(1L)).thenReturn(List.of(new SpmSlotOption("S1", "宜兴城中店")));
        ParamResolveResult r = handler.resolve(1L, source);
        assertEquals(1, r.options().size());
        assertEquals("S1", r.options().get(0).value());
    }

    @Test
    void tenantAdminFallsBackToAllStores() {
        when(slots.fetchAuthorizedStores(1L)).thenReturn(List.of());
        when(iam.hasUnrestrictedStoreAccess(1L)).thenReturn(true);
        when(slots.fetchAllStores(1L)).thenReturn(List.of(
                new SpmSlotOption("A", "A店"),
                new SpmSlotOption("B", "B店")));
        ParamResolveResult r = handler.resolve(1L, source);
        assertEquals(2, r.options().size());
        assertTrue(handler.accepts(1L, source, "B"));
    }

    @Test
    void restrictedUserStaysEmpty() {
        when(slots.fetchAuthorizedStores(9L)).thenReturn(List.of());
        when(iam.hasUnrestrictedStoreAccess(9L)).thenReturn(false);
        ParamResolveResult r = handler.resolve(9L, source);
        assertTrue(r.options().isEmpty());
    }
}
