package com.mis.auth.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.SQLRestriction;

@Entity
@Table(name = "sys_employee")
@SQLRestriction("deleted = 0")
public class SysEmployee {

    @Id
    private Long id;

    @Column(name = "dept_id", nullable = false)
    private Long deptId;

    @Column(name = "real_name", nullable = false)
    private String realName;

    @Column
    private String email;

    /** 手机号，对应列 {@code phone} */
    @Column(name = "phone")
    private String mobile;

    @Column(nullable = false)
    private Integer status;

    public Long getId() {
        return id;
    }

    public Long getDeptId() {
        return deptId;
    }

    public String getRealName() {
        return realName;
    }

    public String getEmail() {
        return email;
    }

    public String getMobile() {
        return mobile;
    }

    public Integer getStatus() {
        return status;
    }
}
