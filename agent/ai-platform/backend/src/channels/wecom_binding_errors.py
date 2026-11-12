"""企微身份绑定里与手机号查询相关的轻量类型（避免循环 import）。

``WecomUserBindingService`` 需要一个「按 tenantId + 手机号 → MIS 用户」的查询
能力，但实现方在 :mod:`src.identity.wecom_phone_lookup`（会 import httpx），
而测试里又要注入假实现。用一个 ``Protocol`` 描述契约，让服务层只依赖这个
小模块，不被具体 HTTP 实现绑死。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable


@dataclass
class PhoneLookupResult:
    """``tenantId + phone`` 的反查结果。

    Attributes:
        matched: 是否唯一命中（``exact-one``）。
        user_id: 命中的 MIS userId；未命中为 ``None``。
        username: 命中的登录名（可选，用于日志）。
        reason: 未命中原因：``not_found`` / ``ambiguous`` / ``error`` 等。
    """

    matched: bool
    user_id: int | None = None
    username: str | None = None
    reason: str = ""


@runtime_checkable
class WecomPhoneLookup(Protocol):
    """按租户 + 手机号反查 MIS 用户的抽象接口。"""

    async def lookup(self, tenant_id: int, phone: str) -> PhoneLookupResult:
        """查询唯一 MIS 用户。"""
        ...
