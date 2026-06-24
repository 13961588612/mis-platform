package com.mis.common.security.jwt;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class RsaJwtVerifierTest {

    private final JwtVerifier verifier = JwtTestSupport.verifier();

    @Test
    void verifiesValidToken() {
        String token = JwtTestSupport.accessToken(1001L, 1L, 1L);
        JwtClaims claims = verifier.verify(token);
        assertThat(claims.userId()).isEqualTo(1001L);
        assertThat(claims.tenantId()).isEqualTo(1L);
        assertThat(claims.appId()).isEqualTo(1L);
        assertThat(claims.jti()).isNotBlank();
    }

    @Test
    void rejectsTamperedToken() {
        assertThatThrownBy(() -> verifier.verify("invalid.token.value"))
                .isInstanceOf(JwtAuthenticationException.class);
    }
}
