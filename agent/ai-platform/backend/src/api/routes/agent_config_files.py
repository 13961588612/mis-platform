"""Agent 配置文件 API 路由（T04 O1d / UI#9）。

端点（前缀 ``/agents``，与既有 agent 路由同批注册）：
- GET    /agents/{agent_id}/config-files                — 可编辑文件树
- GET    /agents/{agent_id}/config-files/{path}         — 读内容（密钥脱敏）
- PUT    /agents/{agent_id}/config-files/{path}         — 写内容（校验 + 热更新）

路径白名单 / 只读 / 脱敏逻辑全部委托 :mod:`src.config_manager.file_service`，
本路由只负责参数解析、鉴权与响应封装。鉴权为「登录即可」（T03 的
``require_ops_permission`` 闸门由 T03 批次统一叠加，不在本非阻塞子集内重复实现）。
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Path as PathParam, status
from pydantic import BaseModel, Field

from src.api.deps import get_current_user
from src.api.response import error_response, success
from src.config_manager import file_service
from src.utils.exceptions import (
    ConfigFileMaskedError,
    ConfigFileTooLargeError,
    ConfigLoadError,
    ConfigPathError,
)
from src.utils.logging import get_logger

logger = get_logger("api.routes.agent_config_files")

router = APIRouter(prefix="/agents", tags=["agent-config-files"])


class WriteConfigFileRequest(BaseModel):
    """写配置文件的请求体。"""

    content: str = Field(..., description="文件完整新内容（YAML 或 Markdown 原文）")


@router.get("/{agent_id}/config-files")
async def list_config_files(
    agent_id: str = PathParam(..., description="Agent ID"),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """列出该 Agent 目录下白名单内的可编辑文件（按磁盘实际存在返回）。"""
    try:
        files: list[dict[str, Any]] = file_service.list_editable_files(agent_id)
        return success(data=files)
    except Exception as exc:
        logger.error("Failed to list config files", agent_id=agent_id, error=str(exc))
        return error_response(9000, str(exc), status.HTTP_500_INTERNAL_SERVER_ERROR)


@router.get("/{agent_id}/config-files/{file_path:path}")
async def get_config_file(
    agent_id: str = PathParam(..., description="Agent ID"),
    file_path: str = PathParam(..., description="相对路径（URL 编码，如 memory%2Fpersonality.md）"),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """读取单个配置文件内容（YAML 自动密钥脱敏）。"""
    try:
        from urllib.parse import unquote

        rel_path: str = unquote(file_path)
        result: dict[str, Any] = file_service.read_config_file(agent_id, rel_path)
        return success(data=result)
    except ConfigPathError as exc:
        return error_response(exc.code, exc.message, status.HTTP_400_BAD_REQUEST)
    except ConfigLoadError as exc:
        return error_response(exc.code, exc.message, status.HTTP_404_NOT_FOUND)
    except Exception as exc:
        logger.error("Failed to read config file", agent_id=agent_id, path=file_path, error=str(exc))
        return error_response(9000, str(exc), status.HTTP_500_INTERNAL_SERVER_ERROR)


@router.put("/{agent_id}/config-files/{file_path:path}")
async def put_config_file(
    req: WriteConfigFileRequest,
    agent_id: str = PathParam(..., description="Agent ID"),
    file_path: str = PathParam(..., description="相对路径（URL 编码）"),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """写入单个配置文件内容（结构校验 + 密钥还原 + 热更新）。"""
    try:
        from urllib.parse import unquote

        rel_path: str = unquote(file_path)
        result: dict[str, Any] = file_service.write_config_file(agent_id, rel_path, req.content)
        return success(data=result, message="Config file saved")
    except ConfigPathError as exc:
        return error_response(exc.code, exc.message, status.HTTP_400_BAD_REQUEST)
    except ConfigLoadError as exc:
        return error_response(exc.code, exc.message, status.HTTP_404_NOT_FOUND)
    except ConfigFileTooLargeError as exc:
        return error_response(exc.code, exc.message, status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)
    except ConfigFileMaskedError as exc:
        return error_response(exc.code, exc.message, status.HTTP_422_UNPROCESSABLE_ENTITY)
    except Exception as exc:
        # 捕获 ConfigValidationError 等
        code: int = getattr(exc, "code", 7001)
        status_code = (
            status.HTTP_400_BAD_REQUEST
            if code == 7001
            else status.HTTP_500_INTERNAL_SERVER_ERROR
        )
        return error_response(code, str(exc), status_code)
