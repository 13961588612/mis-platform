# MIS Nacos Server — JDK 17 + Nacos 2.3.2
#
# 版本锁定 2.3.2：与 Spring Cloud Alibaba 2023.0.1.0 的 nacos-client 一致。
# 运行时使用 JDK 17：可与 mis-auth 等业务进程共用本机 JAVA_HOME（手工同机部署）。
#
# 构建：
#   docker build -f deploy/nacos/Dockerfile -t mis-nacos:2.3.2-jdk17 deploy/nacos
#
# 先准备 PG 插件（仅外置 PG 时需要）：
#   .\scripts\ensure-nacos-pg-plugins.ps1

ARG NACOS_VERSION=2.3.2

FROM eclipse-temurin:17-jre-jammy

ARG NACOS_VERSION
ENV NACOS_VERSION=${NACOS_VERSION} \
    NACOS_HOME=/home/nacos \
    MODE=standalone \
    PREFER_HOST_MODE=hostname \
    NACOS_AUTH_ENABLE=false \
    JVM_XMS=256m \
    JVM_XMX=512m \
    JVM_XMN=128m \
    JAVA_HOME=/opt/java/openjdk \
    TZ=Asia/Shanghai

RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates unzip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /home

RUN curl -fsSL -o nacos-server.zip \
      "https://github.com/alibaba/nacos/releases/download/${NACOS_VERSION}/nacos-server-${NACOS_VERSION}.zip" \
    && unzip -q nacos-server.zip \
    && rm nacos-server.zip \
    && mv nacos /home/nacos \
    && mkdir -p /home/nacos/plugins /home/nacos/logs \
    && chmod +x /home/nacos/bin/*.sh

# PG 外置插件（构建前由 ensure-nacos-pg-plugins.ps1 下载到 plugins/）
# 内嵌模式不依赖这些 JAR；缺失时仅影响 postgresql 模式。
COPY plugins/ /home/nacos/plugins/
COPY server/application.properties /home/nacos/conf/application-pg.properties
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

WORKDIR /home/nacos
EXPOSE 8848 9848 9849

HEALTHCHECK --interval=10s --timeout=5s --retries=18 --start-period=60s \
  CMD curl -fsS "http://127.0.0.1:8848/nacos/" || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
