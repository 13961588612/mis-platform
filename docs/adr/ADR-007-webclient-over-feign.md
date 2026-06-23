# ADR-007: 服务间 HTTP — BFF 用 WebClient，领域服务用 RestClient

## 状态
已接受

## 日期
2026-06-23

## 背景

原规划使用 OpenFeign 做全部服务间调用。在 Spring Boot 3.2 / Spring Cloud 2023 技术栈下需重新评估：

- **OpenFeign**：声明式、上手快，但偏「老式」同步风格，与 Spring 6 推荐的 HTTP 客户端方向不完全一致
- **WebClient**：非阻塞、适合并行聚合与流式场景；Gateway 已是 WebFlux
- **RestClient**（Spring 6.1+）：同步、替代 RestTemplate，适合阻塞式领域服务

本系统特点：

- **mis-admin-bff** 常需并行调用 user + org + rbac（如用户列表补全 orgName、roles）
- **领域服务**（auth→user、user→org）多为单次低频同步调用
- 主体业务服务为 **Spring MVC 阻塞模型**（非全面 WebFlux）

## 决策

**不全面使用 OpenFeign。** 按场景拆分：

| 调用方 | 客户端 | 理由 |
|--------|--------|------|
| mis-admin-bff | **WebClient** + `@LoadBalanced WebClient.Builder` | 并行聚合、超时精细控制、与 Gateway 技术栈一致 |
| 领域微服务（auth/user/org/rbac/system/audit） | **RestClient** + `@LoadBalanced RestClient.Builder` | 阻塞栈、调用简单、无需引入 reactive |
| mis-gateway | 已是 WebFlux | 路由转发，不调用业务 Feign/WebClient |

### BFF 并行聚合示例（规格）

```
GET /users 列表页：
  parallel:
    - user-service: GET /internal/v1/users?page=1
    - org-service:  GET /internal/v1/orgs/names?ids=...  (批量)
  merge → UserVO（含 orgName）
```

使用 `Mono.zip` / `CompletableFuture` 包装，整体超时建议 **3s**。

### 领域服务间调用示例

```
mis-auth 登录成功 → RestClient 调 mis-user 查用户
mis-user 创建用户 → RestClient 调 mis-org 校验 orgId
```

单次串行即可，无需 WebClient。

## 备选方案

| 方案 | 优点 | 缺点 |
|------|------|------|
| A. 全 Feign（原方案） | 声明式接口、代码少 | BFF 并行需 @Async 或多次同步等待；生态偏旧 |
| B. 全 WebClient | 技术统一 | 领域服务 block() 反模式；MVC 栈收益低 |
| C. BFF WebClient + 领域 RestClient（选定） | 各取所长 | 需维护两套 Client 工厂与测试 |
| D. 全 RestClient | 最简单 | BFF 并行需自己管理线程池 |

## 不选用 OpenFeign 的原因（本项目中）

1. BFF 聚合是性能敏感路径，WebClient 并行更自然
2. Spring Cloud OpenFeign 仍可用，但与 Boot 3 新方向（RestClient / WebClient）重复
3. Feign 接口 + DTO 在微服务数量不多时，RestClient 封装成本可控
4. 减少一层抽象，超时/重试/日志更直观

## 实现约定

### 公共模块 `mis-common-web`

```
com.mis.common.web.client/
├── WebClientFactory.java       # @LoadBalanced Builder、统一 filter
├── RestClientFactory.java
├── ServiceClientProperties.java  # 超时、重试
└── ClientRequestInterceptor.java # 透传 X-User-Id, X-Tenant-Id, X-Trace-Id
```

### 超时默认值

| 项 | 值 |
|----|-----|
| connect | 2s |
| read（领域服务） | 5s |
| read（BFF 聚合整体） | 3s |

### 重试

- Phase 1：**不自动重试**写操作
- 读操作：仅 BFF 对幂等 GET 最多重试 1 次（可选）
- 熔断限流：Sentinel 在 Gateway 层，Client 层 Phase 2 再加

### 服务发现

```java
@Bean
@LoadBalanced
WebClient.Builder loadBalancedWebClientBuilder() { ... }

@Bean
@LoadBalanced
RestClient.Builder loadBalancedRestClientBuilder() { ... }
```

调用地址使用服务名：`http://mis-user/internal/v1/users/{id}`

## 后果

### 正面
- BFF 列表接口延迟降低（并行 vs 串行 Feign）
- 与 Spring Boot 3 推荐栈对齐
- Gateway(WebFlux) + BFF(WebClient) 技术连贯

### 负面
- 无 Feign 声明式接口，需手写 Client 类（可用 record + 模板减少重复）
- 团队需熟悉 WebClient 错误处理与 block 边界
- 测试需 WireMock / MockWebServer

## 待确认

- [ ] 是否在 Phase 2 对热点内部 API 引入 Resilience4j
- [ ] Client DTO 是否独立 `mis-api` 模块共享，避免重复定义
