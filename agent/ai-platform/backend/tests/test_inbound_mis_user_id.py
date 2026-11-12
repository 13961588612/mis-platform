"""入站 MIS userId 解析：H5 JWT sub 直取 vs 企微档 2。"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from src.queue.inbound_worker import _resolve_inbound_mis_user_id
from src.queue.redis_stream import InboundStreamMessage


def _inbound(**kwargs: Any) -> InboundStreamMessage:
    """构造最小入站消息。"""
    base: dict[str, Any] = {
        "id": "1-0",
        "session_id": "sess-1",
        "user_id": "",
        "channel": "h5",
        "content": "ping",
        "message_type": "a2ui_run",
        "trace_id": "t1",
        "timestamp": "2026-01-01T00:00:00Z",
    }
    base.update(kwargs)
    return InboundStreamMessage(**base)


@pytest.mark.asyncio
async def test_h5_numeric_user_id_is_mis_user_id() -> None:
    """H5：Gateway 把 MIS JWT sub 写入 userId，应直取为正整数。"""
    result = await _resolve_inbound_mis_user_id(
        _inbound(user_id="42", channel="h5")
    )
    assert result == 42


@pytest.mark.asyncio
async def test_h5_metadata_mis_user_id_preferred() -> None:
    """metadata.misUserId 优先于 user_id。"""
    result = await _resolve_inbound_mis_user_id(
        _inbound(
            user_id="1",
            channel="h5",
            metadata={"misUserId": "99", "a2ui": {}},
        )
    )
    assert result == 99


@pytest.mark.asyncio
async def test_wecom_does_not_treat_userid_as_mis_without_db() -> None:
    """企微渠道不得把 userid 当 MIS userId；DB 不可用时 fail-closed。"""
    with patch(
        "src.db.session.db_session_context",
        side_effect=RuntimeError("no db"),
    ):
        result = await _resolve_inbound_mis_user_id(
            _inbound(user_id="wecom_zhang", channel="wecom-bot")
        )
    assert result is None


@pytest.mark.asyncio
async def test_wecom_uses_db_lookup() -> None:
    """企微渠道走档 2：查库换取 mis_user_id。"""
    mock_db = AsyncMock()

    class _Ctx:
        async def __aenter__(self) -> Any:
            return mock_db

        async def __aexit__(self, *args: Any) -> None:
            return None

    with patch("src.db.session.db_session_context", return_value=_Ctx()):
        with patch(
            "src.identity.mis_user_id.resolve_mis_user_id_async",
            new_callable=AsyncMock,
            return_value=7,
        ) as lookup:
            result = await _resolve_inbound_mis_user_id(
                _inbound(
                    user_id="zhangsan",
                    channel="wecom-bot",
                    channel_user_id="zhangsan",
                )
            )
    assert result == 7
    lookup.assert_awaited_once()
    identity = lookup.await_args.args[0]
    assert identity["channel"] == "wecom-bot"
    assert identity["user_id"] == "zhangsan"
