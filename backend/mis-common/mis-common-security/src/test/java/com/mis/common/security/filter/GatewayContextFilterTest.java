package com.mis.common.security.filter;

import com.mis.common.core.constant.SecurityConstants;
import com.mis.common.security.context.SecurityContextHolder;
import com.mis.common.security.config.MisSecurityAutoConfiguration;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(classes = GatewayContextFilterTest.TestApplication.class)
@AutoConfigureMockMvc
class GatewayContextFilterTest {

    @Autowired
    private MockMvc mockMvc;

    @AfterEach
    void cleanup() {
        SecurityContextHolder.clear();
    }

    @Test
    void resolvesLoginUserFromGatewayHeaders() throws Exception {
        mockMvc.perform(get("/test/login-user")
                        .header(SecurityConstants.HEADER_USER_ID, "1001")
                        .header(SecurityConstants.HEADER_TENANT_ID, "1")
                        .header(SecurityConstants.HEADER_APP_ID, "1")
                        .header(SecurityConstants.HEADER_EMPLOYEE_ID, "2001")
                        .header(SecurityConstants.HEADER_USERNAME, "admin"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.userId").value(1001))
                .andExpect(jsonPath("$.tenantId").value(1))
                .andExpect(jsonPath("$.appId").value(1))
                .andExpect(jsonPath("$.employeeId").value(2001))
                .andExpect(jsonPath("$.username").value("admin"));
    }

    @Test
    void clearsContextAfterRequest() throws Exception {
        mockMvc.perform(get("/test/login-user")
                .header(SecurityConstants.HEADER_USER_ID, "1"));
        assertThat(SecurityContextHolder.getOptional()).isEmpty();
    }

    @Import({MisSecurityAutoConfiguration.class, TestController.class})
    @org.springframework.boot.autoconfigure.SpringBootApplication
    static class TestApplication {
    }

    @RestController
    static class TestController {

        @GetMapping(value = "/test/login-user", produces = MediaType.APPLICATION_JSON_VALUE)
        public LoginUserView loginUser() {
            var user = SecurityContextHolder.getLoginUser();
            LoginUserView view = new LoginUserView();
            view.setUserId(user.getUserId());
            view.setTenantId(user.getTenantId());
            view.setAppId(user.getAppId());
            view.setEmployeeId(user.getEmployeeId());
            view.setUsername(user.getUsername());
            return view;
        }
    }

    static class LoginUserView {
        private Long userId;
        private Long tenantId;
        private Long appId;
        private Long employeeId;
        private String username;

        public Long getUserId() {
            return userId;
        }

        public void setUserId(Long userId) {
            this.userId = userId;
        }

        public Long getTenantId() {
            return tenantId;
        }

        public void setTenantId(Long tenantId) {
            this.tenantId = tenantId;
        }

        public Long getAppId() {
            return appId;
        }

        public void setAppId(Long appId) {
            this.appId = appId;
        }

        public Long getEmployeeId() {
            return employeeId;
        }

        public void setEmployeeId(Long employeeId) {
            this.employeeId = employeeId;
        }

        public String getUsername() {
            return username;
        }

        public void setUsername(String username) {
            this.username = username;
        }
    }
}
