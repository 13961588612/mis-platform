package com.mis.recon.domain.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.Data;

/**
 * 连接保存请求（F48）。
 */
@Data
public class ConnectionSaveReq {

    @NotBlank(message = "连接编码必填")
    @Pattern(regexp = "^[a-z][a-z0-9_]{0,63}$", message = "连接编码须为 snake_case，≤64 字符")
    private String connCode;

    @NotBlank(message = "名称必填")
    @Size(max = 128)
    private String name;

    @NotBlank(message = "类型必填")
    private String type;

    @Size(max = 512)
    private String jdbcUrl;

    @Size(max = 128)
    private String username;

    @Size(max = 256)
    private String password;

    private String propsJson;

    @Size(max = 64)
    private String dbTimezone;

    @Min(0)
    private Integer fetchOverlapSec;

    @Size(max = 200)
    private String clockProbeSql;

    @Size(max = 500)
    private String jdbcPropsLocked;

    private Boolean enabled;
}
