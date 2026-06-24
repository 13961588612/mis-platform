package com.mis.auth.service;

import com.mis.common.security.jwt.AccessTokenClaims;
import com.mis.common.security.jwt.JwtIssuer;
import com.mis.common.security.jwt.JwtTestSupport;
import com.mis.common.security.jwt.JwtVerifier;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class JwtIssueVerifyTest {

    @Test
    void issueAndVerifyAccessToken() {
        JwtIssuer issuer = new com.mis.common.security.jwt.RsaJwtIssuer(JwtTestSupport.privateKey(), 7200);
        JwtVerifier verifier = JwtTestSupport.verifier();

        var issued = issuer.issue(new AccessTokenClaims(1L, 1L, 1L, 1L, "admin", List.of("TENANT_ADMIN"), 2L));
        var claims = verifier.verify(issued.token());

        assertThat(claims.userId()).isEqualTo(1L);
        assertThat(claims.username()).isEqualTo("admin");
        assertThat(claims.jti()).isEqualTo(issued.jti());
    }
}
