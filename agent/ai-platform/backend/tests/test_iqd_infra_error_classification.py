"""基础设施错误识别 / SQL 错误可修复性判定（连接池故障防复发）。

背景（2026-10-02 真机故障）：StarRocks 侧一次断连后，wren 进程池里的连接失效且
不自愈，`dry_run` 100% 失败：

    Error executing tool dry_run: [GENERIC_USER_ERROR] (2006, 'Server has gone away')
    phase=SQL_DRY_RUN

旧实现把 GENERIC_USER_ERROR 当作「可修复的方言错误」，于是连接中断触发了一次
NL→SQL 重生成（白烧 3~5s + token，仍必然失败），并把错误码报成 45205
「未能生成有效查询，请换个说法」——误导用户以为是自己问得不好。

本测试锁定两条不变量：
1. 基础设施 / 连接类错误**不可修复**（不触发 SQL 重生成）；
2. 它们被识别为 infra，据此可归到 45202「服务暂不可用」而非 45205。
同时确保原有可修复性（列错误 / 方言错误）不被误伤。
"""

from __future__ import annotations

import pytest

from src.agent.mis_iqd.sql_errors import (
    is_infra_error,
    is_repairable_sql_error,
    sql_error_text,
)


class _ErrWithPayload(Exception):
    """模拟 wren 错误把细节挂在 payload/detail 属性上（历史形态）。"""

    def __init__(self, message: str, detail: str = "") -> None:
        super().__init__(message)
        self.detail = detail


# ---------------------------------------------------------------------------
# 真实故障原文（wren MCP dry_run 返回）
# ---------------------------------------------------------------------------

GONE_AWAY = "wren MCP 工具失败: dry_run -> Error executing tool dry_run: [GENERIC_USER_ERROR] (2006, 'Server has gone away') phase=SQL_DRY_RUN"


@pytest.mark.parametrize(
    "message",
    [
        GONE_AWAY,
        "Lost connection to MySQL server during query",
        "Connection refused",
        "Can't connect to MySQL server on '10.254.16.217'",
        "read timeout",
        "connect timeout",
        "[GENERIC_USER_ERROR] phase=SQL_DRY_RUN",
    ],
)
def test_infra_errors_are_not_repairable(message: str) -> None:
    """基础设施错误绝不触发 SQL 重生成。"""
    assert is_repairable_sql_error(RuntimeError(message)) is False
    assert is_infra_error(RuntimeError(message)) is True


def test_infra_error_detected_via_detail_attribute() -> None:
    """细节只在 detail 里也要能识别（历史坑：phase=SQL_DRY_RUN 藏在 detail）。"""
    exc = _ErrWithPayload("dry_run 失败", detail="phase=SQL_DRY_RUN")
    assert is_infra_error(exc) is True
    assert is_repairable_sql_error(exc) is False


@pytest.mark.parametrize(
    "message",
    [
        "column 'foo_bar' cannot be resolved",
        "Unknown column 'x' in 'field list'",
        "no such column: y",
        "field not found: z",
        "date_trunc is not supported",
        "unsupported function: date_part",
        "cannot cast VARCHAR to DATE",
    ],
)
def test_sql_errors_still_repairable(message: str) -> None:
    """列错误 / DataFusion 方言错误仍可修复一次（不得被本次改动误伤）。"""
    assert is_repairable_sql_error(RuntimeError(message)) is True
    assert is_infra_error(RuntimeError(message)) is False


def test_generic_user_error_alone_is_not_repairable() -> None:
    """GENERIC_USER_ERROR 是 wren 通用兜底码，单独出现**不得**判为可修复。

    这是本次修复的核心：旧实现把它放进 _DIALECT_ERROR_RE，导致连接中断也触发重生成。
    """
    assert is_repairable_sql_error(
        RuntimeError("[GENERIC_USER_ERROR] something odd")
    ) is False


def test_sql_error_text_merges_detail() -> None:
    """_sql_error_text 合并 str(exc) 与 detail 属性。"""
    exc = _ErrWithPayload("base", detail="DETAIL-TOKEN")
    text = sql_error_text(exc)
    assert "base" in text
    assert "DETAIL-TOKEN" in text
