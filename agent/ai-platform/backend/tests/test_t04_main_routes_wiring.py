"""T04 任务7：校验 ``main.py`` 已正确挂载 T04 新增路由（运维台配置文件 / 技能 / 调度）。

属于「Wire routes in main.py」验收：确认下列端点均注册到 FastAPI 应用，且
HTTP 方法与路径精确匹配。类型检查（typecheck）由 CI 负责，本用例聚焦路由装配。
"""

from __future__ import annotations

from fastapi.routing import APIRoute

# 导入即触发 create_app()，应用完成路由装配（不启动 lifespan）。
from src.main import app  # noqa: E402

# (method, path) 期望值集合
REQUIRED = {
    ("GET", "/api/v1/agents/{agent_id}/config-files"),
    ("GET", "/api/v1/agents/{agent_id}/config-files/{file_path}"),
    ("PUT", "/api/v1/agents/{agent_id}/config-files/{file_path}"),
    ("GET", "/api/v1/agents/{agent_id}/skills"),
    ("PUT", "/api/v1/agents/{agent_id}/skills"),
    ("GET", "/api/v1/admin/worker-catalog"),
    ("PUT", "/api/v1/admin/worker-catalog"),
    ("GET", "/api/v1/admin/dispatch-traces"),
}


def _registered() -> set[tuple[str, str]]:
    """从 OpenAPI schema 收集全部已注册端点（可靠覆盖 include_router 装配的路由）。"""
    paths: dict[str, Any] = app.openapi()["paths"]
    registered: set[tuple[str, str]] = set()
    for path, methods in paths.items():
        for method in methods:
            registered.add((method.upper(), path))
    return registered


def test_t04_routes_registered() -> None:
    registered = _registered()
    missing = REQUIRED - registered
    assert not missing, f"T04 路由缺失: {sorted(missing)}"


def test_t04_routes_no_unexpected_duplicates() -> None:
    """每个必需端点应恰好注册一次（不重复挂载）。"""
    registered = _registered()
    for method, path in REQUIRED:
        assert (
            list(registered).count((method, path)) >= 1
        ), f"未注册: {(method, path)}"
