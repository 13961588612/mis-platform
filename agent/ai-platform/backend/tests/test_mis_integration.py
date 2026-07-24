"""MIS × ai-platform 融合 —— 阶段1（认证对齐）+ 阶段2（BFF 调用目标）集成测试。

覆盖：
1. ``MisTokenVerifier``：RS256 验签、PEM/PATH 加载、公钥优先级、错误公钥拒绝、iss 可选校验
2. ``build_user_context_from_mis``：MIS JWT → 平台 ``UserContext`` 映射
3. ``get_current_user``：RS256 / HS256 分支分流，两路不互相误判
4. ``mis_capability`` 端点：401 无鉴权保护 + 合法 RS256 token 进入处理（Mock Agent runtime）
5. 4 个 Agent 配置（mis-copilot / summary / extract / rag）可加载且 agent_id 正确

说明：
- 真实 MIS RSA 密钥对位于 ``d:/code/mis-platform/backend/keys/{private,public}.pem``，
  本测试直接复用该密钥对签发/验签，验证平台侧 ``MisTokenVerifier`` 的 RS256 链路。
- 端点测试通过 unittest.mock 替换 ``get_session_manager`` / ``get_agent_manager`` 与
  Agent runtime 的 ``process_message``，避免真实 LLM/DB 调用。
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import jwt
import pytest
import yaml

# 确保 backend/ 在 sys.path，使 ``from src.xxx import yyy`` 可用（conftest 已加，这里再保险一次）
_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from src.config import Settings  # noqa: E402
from src.identity.mis_token import (  # noqa: E402
    MisTokenError,
    MisTokenPayload,
    MisTokenVerifier,
    _normalize_pem,
)
from src.identity.models import (  # noqa: E402
    UserContext,
    build_user_context_from_mis,
)
from src.identity.token import TokenManager  # noqa: E402
from src.api.deps import get_current_user  # noqa: E402

# —— 真实 MIS 密钥对（公开密钥，非机密）——
_KEYS = Path("d:/code/mis-platform/backend/keys")
REAL_PRIVATE_PEM = (_KEYS / "private.pem").read_text()
REAL_PUBLIC_PEM = (_KEYS / "public.pem").read_text()

# —— Agent 配置目录（agent/ai-platform/configs/agents）——
_AGENTS_DIR = Path(__file__).resolve().parents[2] / "configs" / "agents"
EXPECTED_AGENTS = {
    "mis-copilot": "mis-copilot",
    "mis-summary": "mis-summary",
    "mis-extract": "mis-extract",
    "mis-rag": "mis-rag",
}


# —— 辅助函数 ——


def _sign_rs256(claims: dict, issuer=None) -> str:
    """用真实 MIS 私钥签发 RS256 token。"""
    payload = dict(claims)
    if issuer is not None:
        payload["iss"] = issuer
    return jwt.encode(payload, REAL_PRIVATE_PEM, algorithm="RS256")


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


def _make_mis_settings(issuer: str = "mis-platform") -> Settings:
    """构造一份指向真实 MIS 公钥的 Settings（内联 PEM 优先）。"""
    s = Settings()
    s.MIS_JWT_PUBLIC_KEY_PEM = REAL_PUBLIC_PEM
    s.MIS_JWT_PUBLIC_KEY_PATH = ""
    s.MIS_JWT_ISSUER = issuer
    s.MIS_JWT_ALGORITHM = "RS256"
    return s


# ===== 1. MisTokenVerifier =====


class TestMisTokenVerifier:
    def test_verify_valid_token_inline_pem(self):
        settings = _make_mis_settings()
        token = _sign_rs256(_base_claims(), issuer="mis-platform")
        payload = MisTokenVerifier(settings).verify(token)

        assert isinstance(payload, MisTokenPayload)
        assert payload.user_id == 42
        assert payload.employee_id == 2001
        assert payload.tenant_id == 10
        assert payload.app_id == 20
        assert payload.username == "zhangsan"
        assert payload.roles == ["hr", "finance"]
        assert payload.perm_version == "v1"

    def test_verify_via_path_file(self):
        settings = Settings()
        settings.MIS_JWT_PUBLIC_KEY_PEM = ""
        settings.MIS_JWT_PUBLIC_KEY_PATH = str(_KEYS / "public.pem")
        settings.MIS_JWT_ISSUER = "mis-platform"
        token = _sign_rs256(_base_claims(), issuer="mis-platform")
        payload = MisTokenVerifier(settings).verify(token)
        assert payload.employee_id == 2001

    def test_pem_takes_priority_over_path(self):
        """设计：PEM > PATH。两者都设时，必须走 PEM，PATH 指向错误文件也不能触发读盘错误。"""
        settings = Settings()
        settings.MIS_JWT_PUBLIC_KEY_PEM = REAL_PUBLIC_PEM
        settings.MIS_JWT_PUBLIC_KEY_PATH = str(_KEYS / "does_not_exist.pem")
        settings.MIS_JWT_ISSUER = "mis-platform"
        token = _sign_rs256(_base_claims(), issuer="mis-platform")
        payload = MisTokenVerifier(settings).verify(token)  # 不应抛 FileNotFoundError
        assert payload.employee_id == 2001

    def test_wrong_public_key_rejected(self):
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import rsa

        wrong = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        wrong_pub = wrong.public_key().public_bytes(
            serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        ).decode()
        settings = Settings()
        settings.MIS_JWT_PUBLIC_KEY_PEM = wrong_pub
        settings.MIS_JWT_ISSUER = "mis-platform"
        token = _sign_rs256(_base_claims(), issuer="mis-platform")
        with pytest.raises(MisTokenError):
            MisTokenVerifier(settings).verify(token)

    def test_iss_mismatch_rejected(self):
        settings = _make_mis_settings(issuer="mis-platform")
        token = _sign_rs256(_base_claims(), issuer="wrong-issuer")
        with pytest.raises(MisTokenError):
            MisTokenVerifier(settings).verify(token)

    def test_iss_absent_token_ok_when_configured(self):
        """设计：iss 可选校验。token 不带 iss 时（即便配置要求），不误拒。"""
        settings = _make_mis_settings(issuer="mis-platform")
        token = _sign_rs256(_base_claims(), issuer=None)
        payload = MisTokenVerifier(settings).verify(token)
        assert payload.employee_id == 2001

    def test_iss_empty_config_skips_validation(self):
        """设计：MIS_JWT_ISSUER 为空时完全跳过 iss 校验。"""
        settings = Settings()
        settings.MIS_JWT_PUBLIC_KEY_PEM = REAL_PUBLIC_PEM
        settings.MIS_JWT_ISSUER = ""
        token = _sign_rs256(_base_claims(), issuer="any-iss-here")
        payload = MisTokenVerifier(settings).verify(token)
        assert payload.employee_id == 2001

    def test_optional_fields_default_when_absent(self):
        settings = _make_mis_settings(issuer="mis-platform")
        token = _sign_rs256({"sub": "7", "employeeId": 7}, issuer="mis-platform")
        payload = MisTokenVerifier(settings).verify(token)
        assert payload.user_id == 7
        assert payload.tenant_id is None
        assert payload.app_id is None
        assert payload.username == ""
        assert payload.roles == []
        assert payload.perm_version is None

    def test_normalize_pem_strips_comments_and_blanks(self):
        raw = "# comment line\n\n-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----\n"
        normalized = _normalize_pem(raw)
        assert "#" not in normalized
        assert normalized.startswith("-----BEGIN PUBLIC KEY-----")
        assert normalized.endswith("-----END PUBLIC KEY-----")


# ===== 2. build_user_context_from_mis =====


class TestBuildUserContextFromMis:
    def _verified_payload(self, claims, issuer="mis-platform") -> MisTokenPayload:
        settings = _make_mis_settings(issuer=issuer)
        token = _sign_rs256(claims, issuer=issuer)
        return MisTokenVerifier(settings).verify(token)

    def test_full_mapping(self):
        payload = self._verified_payload(_base_claims())
        ctx: UserContext = build_user_context_from_mis(payload)

        assert ctx.user_id == "2001"  # str(employee_id)
        assert ctx.channel == "mis_bff"
        assert ctx.department == ""
        assert ctx.dept_id is None
        assert ctx.roles == ["hr", "finance"]
        assert ctx.allowed_categories == []

        profile = ctx.profile
        assert profile["tenant_id"] == 10
        assert profile["app_id"] == 20
        assert profile["mis_user_id"] == 42
        assert profile["employee_id"] == 2001
        assert profile["perm_version"] == "v1"

    def test_fallback_to_user_id_when_employee_id_absent(self):
        payload = self._verified_payload({"sub": "99", "username": "u99"})
        ctx: UserContext = build_user_context_from_mis(payload)
        assert ctx.user_id == "99"
        assert ctx.profile["employee_id"] is None
        assert ctx.profile["mis_user_id"] == 99


# ===== 3. get_current_user 分支分流 =====


class TestGetCurrentUserBranching:
    @pytest.fixture
    def patched_settings(self):
        """把 deps.get_settings 替换为携带真实 MIS 公钥的测试 Settings。"""
        with patch("src.api.deps.get_settings", return_value=_make_mis_settings()):
            yield

    @pytest.mark.asyncio
    async def test_missing_bearer_returns_401(self, patched_settings):
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc:
            await get_current_user(authorization="")
        assert exc.value.status_code == 401

    @pytest.mark.asyncio
    async def test_rs256_enters_mis_branch(self, patched_settings):
        token = _sign_rs256(_base_claims(), issuer="mis-platform")
        result = await get_current_user(authorization=f"Bearer {token}")
        assert result.get("mis") is True
        assert result["user_id"] == "2001"
        assert result["channel"] == "mis_bff"

    @pytest.mark.asyncio
    async def test_rs256_wrong_key_returns_401(self, patched_settings):
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        from fastapi import HTTPException

        wrong = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        wrong_pub = wrong.public_key().public_bytes(
            serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        ).decode()
        bad_settings = Settings()
        bad_settings.MIS_JWT_PUBLIC_KEY_PEM = wrong_pub
        bad_settings.MIS_JWT_ISSUER = "mis-platform"

        # 用真实私钥签发，但验签用错误公钥 → 应 401
        token = _sign_rs256(_base_claims(), issuer="mis-platform")
        with patch("src.api.deps.get_settings", return_value=bad_settings):
            with pytest.raises(HTTPException) as exc:
                await get_current_user(authorization=f"Bearer {token}")
            assert exc.value.status_code == 401

    @pytest.mark.asyncio
    async def test_hs256_enters_native_branch(self, patched_settings):
        tm = TokenManager()
        token_set = tm.create_token_set(
            user_id="u-native", username="nativeuser", roles=["admin"]
        )
        result = await get_current_user(authorization=f"Bearer {token_set.access_token}")
        # 原生分支：不带 mis 标志，带平台自有声明
        assert "mis" not in result
        assert result["user_id"] == "u-native"
        assert result["username"] == "nativeuser"
        assert result["channel"] == "wecom_h5"

    @pytest.mark.asyncio
    async def test_two_paths_do_not_misclassify(self, patched_settings):
        tm = TokenManager()
        native = tm.create_token_set(user_id="u1", username="u1")
        native_result = await get_current_user(authorization=f"Bearer {native.access_token}")
        assert "mis" not in native_result

        mis_token = _sign_rs256(_base_claims(), issuer="mis-platform")
        mis_result = await get_current_user(authorization=f"Bearer {mis_token}")
        assert mis_result.get("mis") is True
        # 两条 token 互不串路
        assert "mis" not in native_result
        assert "mis" in mis_result


# ===== 4. mis_capability 端点 =====


class TestMisCapabilityEndpoint:
    @pytest.fixture
    def client(self):
        from fastapi.testclient import TestClient
        from src.api.routes import mis_capability as mc
        from src.main import app
        from src.runtime.events import AgentEvent

        fake_session = MagicMock()
        fake_session.session_id = "sess-mock-001"
        mock_session_mgr = MagicMock()
        mock_session_mgr.create_session = AsyncMock(return_value=fake_session)
        mock_session_mgr.add_message = AsyncMock()

        async def fake_process_message(session, message):
            yield AgentEvent.text_delta("hello from mock agent")

        fake_instance = MagicMock()
        fake_instance.process_message = fake_process_message
        mock_agent_mgr = MagicMock()
        mock_agent_mgr.ensure_agent_ready = AsyncMock(return_value=fake_instance)

        with patch.object(mc, "get_session_manager", return_value=mock_session_mgr), patch.object(
            mc, "get_agent_manager", return_value=mock_agent_mgr
        ), patch("src.api.deps.get_settings", return_value=_make_mis_settings()):
            yield TestClient(app)

    def test_no_auth_returns_401(self, client):
        resp = client.post(
            "/api/v1/agents/mis-summary/chat",
            json={"content": "hi", "role": "user", "metadata": {}},
        )
        assert resp.status_code == 401

    def test_valid_rs256_enters_processing(self, client):
        token = _sign_rs256(_base_claims(), issuer="mis-platform")
        resp = client.post(
            "/api/v1/agents/mis-summary/chat",
            headers={"Authorization": f"Bearer {token}", "X-Trace-Id": "t-abc-123"},
            json={
                "content": "summary this",
                "role": "user",
                "metadata": {"capability": "summary"},
            },
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["code"] == 0
        assert body["message"] == "ok"
        assert "session_id" in body["data"]
        assert body["data"]["session_id"] == "sess-mock-001"
        assert body["data"]["response"] == "hello from mock agent"
        assert body["traceId"] == "t-abc-123"


# ===== 5. Agent 配置可加载 =====


class TestAgentConfigs:
    def test_four_mis_agents_loadable_and_agent_id_correct(self):
        for agent_dir, expected_id in EXPECTED_AGENTS.items():
            cfg_path = _AGENTS_DIR / agent_dir / "agent.yaml"
            assert cfg_path.exists(), f"缺失 Agent 配置：{cfg_path}"

            with open(cfg_path, "r", encoding="utf-8") as fh:
                data = yaml.safe_load(fh)  # 不报错即视为可加载

            agent = data.get("agent", {})
            assert agent.get("name") == expected_id, (
                f"{agent_dir}: 期望 agent.name={expected_id}，实际 {agent.get('name')}"
            )
