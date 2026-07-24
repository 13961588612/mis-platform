"""T-stream 平台 SSE 流式契约测试（设计 §2 / T-stream-plt）。

覆盖：
1. ``POST /api/v1/agents/{agent_id}/chat/stream`` 的 SSE 事件契约：
   - 事件序列为 ``delta → ... → done``（至少一帧 delta，末帧 done，无 error）；
   - 事件名精确匹配 ``delta | done | error``；
   - 每帧 data 载荷含 ``traceId``；delta 帧含 ``delta``，done 帧含 ``finishReason`` / ``sessionId``。
2. 401 无鉴权保护（与既非流式端点一致）。
3. T-ext-2 / T-sum-plt 离线契约锚点：mis-extract / mis-summary 的 system.md 含目标契约关键词。

通过 unittest.mock 替换 ``get_session_manager`` / ``get_agent_manager`` 与 Agent runtime 的
``process_message``，避免真实 LLM/DB 调用（与 test_mis_integration.py 同手法）。
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import jwt
import pytest

_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from src.config import Settings  # noqa: E402
from src.identity.mis_token import MisTokenVerifier  # noqa: E402
from src.runtime.events import AgentEvent  # noqa: E402

# —— 真实 MIS 密钥对（公开密钥，非机密）——
_KEYS = Path("d:/code/mis-platform/backend/keys")
REAL_PRIVATE_PEM = (_KEYS / "private.pem").read_text()
REAL_PUBLIC_PEM = (_KEYS / "public.pem").read_text()

# —— Agent 配置目录（agent/ai-platform/configs/agents）——
_AGENTS_DIR = Path(__file__).resolve().parents[2] / "configs" / "agents"


def _sign_rs256(claims: dict, issuer: str = "mis-platform") -> str:
    """用真实 MIS 私钥签发 RS256 token。"""
    return jwt.encode(claims, REAL_PRIVATE_PEM, algorithm="RS256")


def _base_claims() -> dict:
    return {
        "sub": "42",
        "employeeId": 2001,
        "tenantId": 10,
        "appId": 20,
        "username": "zhangsan",
        "roles": ["hr", "finance"],
        "permVersion": "v1",
    }


def _mis_settings(issuer: str = "mis-platform") -> Settings:
    """构造一份指向真实 MIS 公钥的 Settings。"""
    s = Settings()
    s.MIS_JWT_PUBLIC_KEY_PEM = REAL_PUBLIC_PEM
    s.MIS_JWT_PUBLIC_KEY_PATH = ""
    s.MIS_JWT_ISSUER = issuer
    s.MIS_JWT_ALGORITHM = "RS256"
    return s


def _parse_sse_frames(text: str) -> list:
    """将 SSE 文本解析为 ``[{event, data(dict)}]`` 列表。

    平台 ``_sse_frame`` 产出的帧格式为 ``event: <name>\\ndata: <json>\\n\\n``。
    """
    frames: list = []
    for block in text.split("\n\n"):
        block = block.strip()
        if not block:
            continue
        event = None
        data_lines: list = []
        for line in block.splitlines():
            if line.startswith("event:"):
                event = line[len("event:") :].strip()
            elif line.startswith("data:"):
                data_lines.append(line[len("data:") :].strip())
        if event is None or not data_lines:
            continue
        data_str = "\n".join(data_lines)
        try:
            data = json.loads(data_str)
        except json.JSONDecodeError:
            data = {"__raw__": data_str}
        frames.append({"event": event, "data": data})
    return frames


class TestMisStreamContract:
    """平台 SSE 端点契约（事件名 + 序列 + traceId）。"""

    @pytest.fixture
    def client(self):
        from fastapi.testclient import TestClient
        from src.api.routes import mis_capability as mc
        from src.main import app

        fake_session = MagicMock()
        fake_session.session_id = "sess-stream-001"
        mock_session_mgr = MagicMock()
        mock_session_mgr.create_session = AsyncMock(return_value=fake_session)
        mock_session_mgr.add_message = AsyncMock()

        async def fake_process_message(session, message):
            for chunk in ["你好", "，", "我是", "MIS Copilot"]:
                yield AgentEvent.text_delta(chunk)

        fake_instance = MagicMock()
        fake_instance.process_message = fake_process_message
        mock_agent_mgr = MagicMock()
        mock_agent_mgr.ensure_agent_ready = AsyncMock(return_value=fake_instance)

        with patch.object(mc, "get_session_manager", return_value=mock_session_mgr), patch.object(
            mc, "get_agent_manager", return_value=mock_agent_mgr
        ), patch("src.api.deps.get_settings", return_value=_mis_settings()):
            yield TestClient(app)

    def test_stream_emits_delta_then_done(self, client):
        token = _sign_rs256(_base_claims())
        resp = client.post(
            "/api/v1/agents/mis-copilot/chat/stream",
            headers={"Authorization": f"Bearer {token}", "X-Trace-Id": "t-stream-1"},
            json={"content": "你好", "role": "user", "metadata": {"capability": "chat"}},
        )
        assert resp.status_code == 200, resp.text

        frames = _parse_sse_frames(resp.text)
        assert frames, "应当至少产出一帧 SSE"

        # 事件名精确匹配 delta | done | error
        valid = {"delta", "done", "error"}
        assert all(f["event"] in valid for f in frames), (
            f"非法事件名: {[f['event'] for f in frames]}"
        )

        # 至少一帧 delta，末帧 done，且不应出现 error
        assert any(f["event"] == "delta" for f in frames), "缺少 delta 帧"
        assert frames[-1]["event"] == "done", f"末帧应为 done，实际 {frames[-1]['event']}"
        assert not any(f["event"] == "error" for f in frames), "不应出现 error 帧"

        # 每帧 data 含 traceId
        for f in frames:
            assert "traceId" in f["data"], f"帧 {f['event']} 缺少 traceId"

        # delta 帧携带 delta 字段；done 帧携带 finishReason / sessionId
        delta_frames = [f for f in frames if f["event"] == "delta"]
        assert all("delta" in f["data"] for f in delta_frames)
        # 累积 delta 应还原完整文本
        acc = "".join(f["data"]["delta"] for f in delta_frames)
        assert acc == "你好，我是MIS Copilot", acc

        done = [f for f in frames if f["event"] == "done"][0]
        assert "finishReason" in done["data"] and "sessionId" in done["data"]

    def test_no_auth_returns_401(self, client):
        resp = client.post(
            "/api/v1/agents/mis-copilot/chat/stream",
            json={"content": "hi", "role": "user", "metadata": {}},
        )
        assert resp.status_code == 401


class TestExtractSummaryPromptContract:
    """T-ext-2 / T-sum-plt 离线契约锚点（无需 LLM，校验 system.md 已对齐目标契约）。"""

    def test_extract_prompt_requires_object_confidence_and_unmapped(self):
        prompt = (
            _AGENTS_DIR / "mis-extract" / "runtime" / "prompts" / "system.md"
        ).read_text(encoding="utf-8")
        assert "confidence" in prompt, "mis-extract system.md 应要求 confidence"
        # 对象式逐字段 confidence：示例必须是对象（键=字段名，值=0~1），而非标量 Double。
        # 若此处退化成 "\"confidence\": 0.87" 之类标量，T-ext-2 契约即被破坏。
        assert re.search(
            r'"confidence"\s*:\s*\{\s*"\w+"\s*:\s*0?\.\d+', prompt
        ), (
            "mis-extract system.md 必须将 confidence 示例为对象式逐字段 "
            "{<AdminField.key>: 0~1}，而非标量"
        )
        # 反向约束：不应出现标量式 confidence（防止 prompt 被回退成旧形态）
        assert not re.search(r'"confidence"\s*:\s*\d+\.\d+\s*[,}\n]', prompt), (
            "mis-extract system.md 不应将 confidence 写成标量（T-ext-2 要求对象式）"
        )
        # unmapped 必须为 [{raw, hint?}] 形态，而非纯 List<String>
        assert "unmapped" in prompt, "mis-extract system.md 应要求 unmapped"
        assert '"raw"' in prompt and '"hint"' in prompt, (
            "mis-extract system.md 应将 unmapped 示例为 [{raw, hint?}] 形态"
        )
        assert (
            "schema.fields" in prompt or "AdminField.key" in prompt
        ), "mis-extract 应明令字段 key 真源为前端 AdminField.key / schema.fields[].name"

    def test_summary_prompt_requires_structured_points_and_citations(self):
        prompt = (
            _AGENTS_DIR / "mis-summary" / "runtime" / "prompts" / "system.md"
        ).read_text(encoding="utf-8")
        assert "summary" in prompt, "mis-summary system.md 应要求 summary"
        assert "points" in prompt, "mis-summary system.md 应要求 points"
        assert "citations" in prompt, "mis-summary system.md 应要求 citations"
        # points 必须结构化 [{label, value, risk}]，而非纯 List<String>
        for key in ("label", "value", "risk"):
            assert f'"{key}"' in prompt, (
                f"mis-summary system.md 的 points 应含结构化字段 {key}"
            )
        # citations 必须结构化 [{field, value, source}]
        for key in ("field", "value", "source"):
            assert f'"{key}"' in prompt, (
                f"mis-summary system.md 的 citations 应含结构化字段 {key}"
            )
        # risk 枚举 low|medium|high（PRD Q5）
        assert "low" in prompt and "medium" in prompt and "high" in prompt, (
            "mis-summary 应要求 risk in {low,medium,high}"
        )
