package com.mis.auth.domain.repository;

import com.mis.auth.domain.entity.RefreshTokenEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Optional;

public interface RefreshTokenRepository extends JpaRepository<RefreshTokenEntity, Long> {

    Optional<RefreshTokenEntity> findByTokenHashAndRevoked(String tokenHash, Integer revoked);

    @Modifying
    @Query("UPDATE RefreshTokenEntity r SET r.revoked = 1 WHERE r.tokenHash = :tokenHash")
    int revokeByTokenHash(@Param("tokenHash") String tokenHash);

    @Query("""
            SELECT COUNT(DISTINCT r.userId) FROM RefreshTokenEntity r
            WHERE r.appId = :appId AND r.revoked = 0 AND r.expireAt > :now
            """)
    long countOnlineUsers(@Param("appId") Long appId, @Param("now") Instant now);
}
