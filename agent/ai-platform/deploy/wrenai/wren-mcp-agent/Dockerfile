# WrenMcpAgent 镜像（wren 机，Linux + systemd 可选；本 Dockerfile 直接托管进程）
FROM python:3.11-slim

# wren CLI 由部署侧注入（官方二进制 / 镜像层），此处仅保证 python 运行环境
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /opt/wren-mcp-agent

COPY requirements.txt /opt/wren-mcp-agent/requirements.txt
RUN pip install -r requirements.txt

COPY utils /opt/wren-mcp-agent/utils
COPY agent.py /opt/wren-mcp-agent/agent.py

# 持久卷：project 目录 + 凭证临时文件（即用即删，但 volume 保证重启不丢 project）
VOLUME ["/var/lib/mis-iqd/wren-projects"]

# 控制面 9100 + 数据面 9101（决策 ② 内网隔离，去 mTLS）
EXPOSE 9100 9101

CMD ["python", "agent.py"]
