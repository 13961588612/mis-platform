package com.mis.recon.domain.config;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.DynamicUpdate;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;

/**
 * 连接配置（recon_connection，V1 29~47 行）。
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Entity
@Table(name = "recon_connection")
@DynamicUpdate
public class ReconConnection {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "conn_code", length = 64, nullable = false)
    private String connCode;

    @Column(length = 128)
    private String name;

    @Column(length = 32, nullable = false)
    private String type;

    @Column(name = "jdbc_url", length = 512)
    private String jdbcUrl;

    @Column(length = 128)
    private String username;

    @Column(length = 256)
    @JsonProperty(access = JsonProperty.Access.WRITE_ONLY)
    private String password;

    @Column(name = "props_json")
    @JdbcTypeCode(SqlTypes.JSON)
    private String propsJson;

    @Column(name = "db_timezone", length = 64)
    private String dbTimezone;

    @Column(name = "fetch_overlap_sec")
    private Integer fetchOverlapSec;

    @Column(name = "clock_probe_sql", length = 200)
    private String clockProbeSql;

    @Column(name = "jdbc_props_locked", length = 500)
    private String jdbcPropsLocked;

    @Column
    private Integer enabled;

    @Column(name = "created_at", insertable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", insertable = false)
    private LocalDateTime updatedAt;

    @PreUpdate
    public void preUpdate() {
        this.updatedAt = LocalDateTime.now();
    }
}
