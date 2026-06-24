package com.mis.common.security.jwt;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class RsaJwtIssuerTest {

    @Test
    void issueAndVerifyRoundTrip() {
        JwtIssuer issuer = new RsaJwtIssuer(JwtTestSupport.privateKey(), 7200);
        IssuedAccessToken issued = issuer.issue(new AccessTokenClaims(
                1001L, 1L, 1L, 2001L, "admin", List.of("TENANT_ADMIN"), 3L));

        JwtClaims claims = JwtTestSupport.verifier().verify(issued.token());
        assertThat(claims.userId()).isEqualTo(1001L);
        assertThat(claims.jti()).isEqualTo(issued.jti());
        assertThat(claims.username()).isEqualTo("admin");
        assertThat(issued.expiresInSeconds()).isEqualTo(7200);
    }
}
