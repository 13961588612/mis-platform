"""API 路由模块 — Agent、Session、Admin、Skill、MCP、Push 和 Files 端点。"""

from src.api.routes.admin import router as admin_router
from src.api.routes.agent import router as agent_router
from src.api.routes.files import router as files_router
from src.api.routes.mcp import router as mcp_router
from src.api.routes.push import router as push_router
from src.api.routes.session import router as session_router
from src.api.routes.skill import router as skill_router

__all__ = [
    "agent_router",
    "session_router",
    "files_router",
    "admin_router",
    "skill_router",
    "mcp_router",
    "push_router",
]
