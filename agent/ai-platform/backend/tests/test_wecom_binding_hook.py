"""企微 Bot 入站身份解析 hook 的测试（wecom-user-binding-design.md §9）。

覆盖：仅 ``wecom-bot`` 渠道 + 能由 Bot 配置推导 corp_id 时才进入绑定解析；
其余情况一律返回 ``None``（由调用方回落旧路径），且任何异常都不外抛。
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from src.channels import wecom_binding_hook as hook


class _FakeBotStore:
    def __init__(self, record: Any) -> None:
        self._record = record

    def get_record(self, bot_id: str) -> Any:
        if self._record is None:
            raise KeyError(bot_id)
        return self._record


class _FakeService:
    calls: list[dict[str, Any]] = []

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        pass

    async def resolve(self, db: Any, input: Any) -> int | None:
        _FakeService.calls.append(
            {
                "corp_id": input.corp_id,
                "tenant_id": input.tenant_id,
                "wecom_user_id": input.wecom_user_id,
                "user_mobile": input.user_mobile,
            }
        )
        return 1001


def _inbound(**kw: Any) -> SimpleNamespace:
    base = {
        "channel": "wecom-bot",
        "channel_user_id": "wecom_zhangsan",
        "user_id": "wecom_zhangsan",
        "user_mobile": "",
        "metadata": {"botId": "wb-1"},
    }
    base.update(kw)
    return SimpleNamespace(**base)


@pytest.mark.asyncio
async def test_hook_resolves_when_bot_has_corp(monkeypatch) -> None:
    _FakeService.calls.clear()
    record = SimpleNamespace(corp_id="ww-1", tenant_id=1)
    monkeypatch.setattr(
        "src.channels.wecom_bot_store.get_wecom_bot_store",
        lambda: _FakeBotStore(record),
    )
    monkeypatch.setattr(hook, "WecomUserBindingService", _FakeService)

    resolved = await hook.resolve_wecom_bot_binding(object(), _inbound(user_mobile="13800000000"))
    assert resolved == 1001
    assert _FakeService.calls == [
        {"corp_id": "ww-1", "tenant_id": 1, "wecom_user_id": "zhangsan", "user_mobile": "13800000000"}
    ]


@pytest.mark.asyncio
async def test_hook_returns_none_without_corp(monkeypatch) -> None:
    _FakeService.calls.clear()
    record = SimpleNamespace(corp_id="", tenant_id=1)
    monkeypatch.setattr(
        "src.channels.wecom_bot_store.get_wecom_bot_store",
        lambda: _FakeBotStore(record),
    )
    monkeypatch.setattr(hook, "WecomUserBindingService", _FakeService)
    assert await hook.resolve_wecom_bot_binding(object(), _inbound()) is None
    assert _FakeService.calls == []


@pytest.mark.asyncio
async def test_hook_ignores_non_wecom_channel(monkeypatch) -> None:
    _FakeService.calls.clear()
    monkeypatch.setattr(hook, "WecomUserBindingService", _FakeService)
    assert await hook.resolve_wecom_bot_binding(object(), _inbound(channel="h5")) is None
    assert _FakeService.calls == []


@pytest.mark.asyncio
async def test_hook_returns_none_without_bot_metadata(monkeypatch) -> None:
    _FakeService.calls.clear()
    monkeypatch.setattr(hook, "WecomUserBindingService", _FakeService)
    assert await hook.resolve_wecom_bot_binding(object(), _inbound(metadata={})) is None
    assert _FakeService.calls == []
