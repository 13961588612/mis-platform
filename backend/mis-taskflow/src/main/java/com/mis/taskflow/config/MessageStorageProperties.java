package com.mis.taskflow.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 消息文件对象存储（MinIO）。密钥来自环境变量，不写进仓库。
 */
@ConfigurationProperties(prefix = "mis.message.storage")
public class MessageStorageProperties {

    private String endpoint = "http://127.0.0.1:9000";
    private String accessKey = "minioadmin";
    private String secretKey = "minioadmin";
    private String bucket = "mis-message";

    public String getEndpoint() { return endpoint; }
    public void setEndpoint(String endpoint) { this.endpoint = endpoint; }
    public String getAccessKey() { return accessKey; }
    public void setAccessKey(String accessKey) { this.accessKey = accessKey; }
    public String getSecretKey() { return secretKey; }
    public void setSecretKey(String secretKey) { this.secretKey = secretKey; }
    public String getBucket() { return bucket; }
    public void setBucket(String bucket) { this.bucket = bucket; }
}
