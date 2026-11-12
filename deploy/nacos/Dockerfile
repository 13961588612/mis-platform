# MIS Nacos Server — JDK 17 + 官方发行包（默认 2.3.2）
#
# 生产机多半拉不下 GitHub：构建前把 zip 放到本目录（与 Dockerfile 同级），再 build。
#
# 准备：
#   1) 插件：bash scripts/ensure-nacos-pg-plugins.sh deploy/nacos/plugins java17
#   2) 发行包（任选其一）：
#      - 能上网机器下载后 scp：
#          nacos-server-2.3.2.zip → deploy/nacos/
#      - 或服务器用镜像代理：
#          curl -fL -o nacos-server-2.3.2.zip \
#            "https://ghfast.top/https://github.com/alibaba/nacos/releases/download/2.3.2/nacos-server-2.3.2.zip"
#   3) docker build -f deploy/nacos/Dockerfile -t mis-nacos:2.3.2-jdk17 deploy/nacos
#
# 换版本：把 zip 换成对应文件，并 --build-arg NACOS_VERSION=2.5.4

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

# 本地 zip（勿在 Dockerfile 里 curl GitHub）
COPY nacos-server-${NACOS_VERSION}.zip /tmp/nacos-server.zip
RUN unzip -q /tmp/nacos-server.zip -d /tmp \
    && rm /tmp/nacos-server.zip \
    && mv /tmp/nacos /home/nacos \
    && mkdir -p /home/nacos/plugins /home/nacos/logs \
    && chmod +x /home/nacos/bin/*.sh

# PG 外置插件（构建前由 ensure 脚本下载到 plugins/）
COPY plugins/ /home/nacos/plugins/
COPY server/application.properties /home/nacos/conf/application-pg.properties
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

WORKDIR /home/nacos
EXPOSE 8848 9848 9849

HEALTHCHECK --interval=10s --timeout=5s --retries=18 --start-period=60s \
  CMD curl -fsS "http://127.0.0.1:8848/nacos/" || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
