package com.mis.recon;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * 对账平台核心服务入口。
 * 只做装配：加载自动配置 + 启动上下文；不写任何业务逻辑。
 */
@SpringBootApplication
public class ReconApplication {

    public static void main(String[] args) {
        SpringApplication.run(ReconApplication.class, args);
    }
}
