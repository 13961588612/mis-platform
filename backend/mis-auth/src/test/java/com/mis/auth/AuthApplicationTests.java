package com.mis.auth;

import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

@Disabled("需要 PostgreSQL + Redis + JWT 私钥配置")
@SpringBootTest
class AuthApplicationTests {

    @Test
    void contextLoads() {
    }
}
