"""身份 enrichment 增量（T2 / T3 / T5）测试 —— 新增用例，不修改既有 148 测试。

覆盖：
1. T2 build_user_context 头缺失 → 退化为阶段1/2 行为（多值字段全空，roles 回落 JWT）。
2. T2 build_user_context 带 X-Mis-* 头 → 多值 + allowed_categories 并集去重 + can_approve 规则。
3. T3 MisTokenVerifier iss 强校验开 / 关两种模式。
4. T5 get_current_user（RS256 分支）带 / 不带 X-Mis-* 头 → 多值字段正确填充。
5. T5 端点鉴权（带 / 不带 X-Mis-* 头的 RS256 分支）仍 200。

密钥对复用 d:/code/mis-platform/backend/keys/{private,public}.pem。
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import jwt
import pytest

_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from src.config import Settings  # noqa: E402
from src.identity.mis_token import MisTokenError, MisTokenVerifier  # noqa: E402
from src.identity.models import (  # noqa: E402
    APPROVAL_DEPT_IDS,
    UserContext,
    build_user_context,
)
from src.identity.permissions import (  # noqa: E402
    PermissionEngine,
    PermissionEngineCategoryResolver,
    get_category_resolver,
)
from src.api.deps import get_current_user  # noqa: E402

# —— 真实 MIS 密钥对（公开密钥，非机密）——
_KEYS = Path("d:/code/mis-platform/backend/keys")
REAL_PRIVATE_PEM = (_KEYS / "private.pem").read_text()
REAL_PUBLIC_PEM = (_KEYS / "public.pem").read_text()


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


def _mis_settings(issuer: str = "mis-platform", verify_iss: bool = False) -> Settings:
    s = Settings()
    s.MIS_JWT_PUBLIC_KEY_PEM = REAL_PUBLIC_PEM
    s.MIS_JWT_PUBLIC_KEY_PATH = ""
    s.MIS_JWT_ISSUER = issuer
    s.MIS_JWT_ALGORITHM = "RS256"
    s.MIS_JWT_VERIFY_ISS = verify_iss
    return s


def _verified_payload(claims, issuer: str = "mis-platform", verify_iss: bool = False):
    token = _sign_rs256(claims, issuer=issuer)
    return MisTokenVerifier(_mis_settings(issuer=issuer, verify_iss=verify_iss)).verify(token)


def _resolver_with_categories() -> PermissionEngineCategoryResolver:
    """构造一个已装载分类目录的 resolver（hr/finance 角色 + 1001 部门）。"""
    engine = PermissionEngine()
    engine.set_role_data("hr", {"allowed_categories": ["cat_hr", "cat_shared"], "can_approve": False})
    engine.set_role_data(
        "finance", {"allowed_categories": ["cat_finance", "cat_shared"], "can_approve": True}
    )
    engine.set_dept_data("1001", {"allowed_categories": ["cat_hr"], "denied_categories": []})
    return PermissionEngineCategoryResolver(engine)


# ===== T2：头缺失 → 退化 =====


class TestBuildUserContextDegrade:
    def test_no_headers_degrades_to_legacy(self):
        p = _verified_payload(_base_claims())
        ctx: UserContext = build_user_context(p, None, None)
        # 多值字段全空，等价于阶段1/2 行为
        assert ctx.departments == []
        assert ctx.organizations == []
        assert ctx.role_infos == []
        assert ctx.allowed_categories == []
        assert ctx.primary_department_id is None
        assert ctx.dept_id is None
        assert ctx.primary_org_id is None
        # 兼容字段保留旧语义
        assert ctx.department == ""
        assert ctx.roles == ["hr", "finance"]
        assert ctx.channel == "mis_bff"

    def test_no_headers_with_resolver_still_degrades(self):
        p = _verified_payload(_base_claims())
        ctx: UserContext = build_user_context(p, None, _resolver_with_categories())
        assert ctx.departments == []
        assert ctx.allowed_categories == []
        assert ctx.roles == ["hr", "finance"]


# ===== T2：带 X-Mis-* 头 → 多值 + 并集去重 + can_approve =====


class TestBuildUserContextWithHeaders:
    def test_multi_value_and_category_union_dedup(self):
        p = _verified_payload(_base_claims())
        headers = {
            "X-Mis-Depts": '[{"id":"1001","name":"人力资源部"}]',
            "X-Mis-Orgs": '[{"id":"10"}]',
            "X-Mis-Roles": '[{"id":"55","code":"hr"},{"id":"56","code":"finance"}]',
        }
        ctx: UserContext = build_user_context(p, headers, _resolver_with_categories())

        assert [d.dept_id for d in ctx.departments] == ["1001"]
        assert ctx.primary_department_id == "1001"
        assert ctx.dept_id == "1001"  # 兼容 PermissionEngine 单值过渡
        assert [o.org_id for o in ctx.organizations] == ["10"]
        assert ctx.primary_org_id == "10"
        assert [r.role_id for r in ctx.role_infos] == ["hr", "finance"]

        # allowed_categories = (dept1001→cat_hr) ∪ (hr→cat_hr,cat_shared) ∪ (finance→cat_finance,cat_shared) 去重
        assert set(ctx.allowed_categories) == {"cat_hr", "cat_shared", "cat_finance"}

        # user.roles 优先取 X-Mis-Roles 的 code
        assert ctx.roles == ["hr", "finance"]
        # finance 可审批 → True
        assert ctx.can_approve is True

    def test_can_approve_via_approval_dept(self):
        p = _verified_payload(_base_claims())
        engine = PermissionEngine()
        engine.set_dept_data("9999", {"allowed_categories": []})
        APPROVAL_DEPT_IDS.add("9999")
        try:
            resolver = PermissionEngineCategoryResolver(engine)
            headers = {
                "X-Mis-Depts": '[{"id":"9999"}]',
                "X-Mis-Roles": '[{"id":"1","code":"viewer"}]',
            }
            ctx: UserContext = build_user_context(p, headers, resolver)
            # 角色不可审批，但部门 9999 在审批白名单 → can_approve True
            assert ctx.can_approve is True
        finally:
            APPROVAL_DEPT_IDS.discard("9999")

    def test_roles_fallback_to_jwt_when_no_role_header(self):
        p = _verified_payload(_base_claims())
        headers = {
            "X-Mis-Depts": '[{"id":"1001"}]',
            "X-Mis-Orgs": '[{"id":"10"}]',
            # 无 X-Mis-Roles
        }
        ctx: UserContext = build_user_context(p, headers, _resolver_with_categories())
        # 无 X-Mis-Roles → roles 回落到 JWT roles
        assert ctx.roles == ["hr", "finance"]
        assert ctx.role_infos == []


# ===== T3：iss 强校验 开 / 关 =====


class TestIssVerification:
    def test_soft_mode_allows_no_iss(self):
        token = _sign_rs256(_base_claims(), issuer=None)
        payload = MisTokenVerifier(_mis_settings(verify_iss=False)).verify(token)
        assert payload.iss is None

    def test_soft_mode_allows_matching_iss(self):
        token = _sign_rs256(_base_claims(), issuer="mis-platform")
        payload = MisTokenVerifier(_mis_settings(verify_iss=False)).verify(token)
        assert payload.iss == "mis-platform"

    def test_soft_mode_rejects_mismatch(self):
        token = _sign_rs256(_base_claims(), issuer="wrong-issuer")
        with pytest.raises(MisTokenError):
            MisTokenVerifier(_mis_settings(verify_iss=False)).verify(token)

    def test_strong_mode_requires_iss(self):
        token = _sign_rs256(_base_claims(), issuer=None)
        with pytest.raises(MisTokenError):
            MisTokenVerifier(_mis_settings(verify_iss=True)).verify(token)

    def test_strong_mode_rejects_mismatch(self):
        token = _sign_rs256(_base_claims(), issuer="wrong-issuer")
        with pytest.raises(MisTokenError):
            MisTokenVerifier(_mis_settings(verify_iss=True)).verify(token)

    def test_strong_mode_allows_matching_iss(self):
        token = _sign_rs256(_base_claims(), issuer="mis-platform")
        payload = MisTokenVerifier(_mis_settings(verify_iss=True)).verify(token)
        assert payload.iss == "mis-platform"


# ===== T5：get_current_user（RS256 分支）带 / 不带 X-Mis-* 头 =====


class TestGetCurrentUserEnrichment:
    @pytest.fixture
    def patched_settings(self):
        with patch("src.api.deps.get_settings", return_value=_mis_settings()):
            yield

    @pytest.mark.asyncio
    async def test_rs256_no_headers_multi_value_empty(self, patched_settings):
        token = _sign_rs256(_base_claims(), issuer="mis-platform")
        result = await get_current_user(authorization=f"Bearer {token}")
        assert result.get("mis") is True
        assert result["roles"] == ["hr", "finance"]
        assert result["departments"] == []
        assert result["allowed_categories"] == []
        assert result["channel"] == "mis_bff"

    @pytest.mark.asyncio
    async def test_rs256_with_headers_multi_value(self, patched_settings):
        token = _sign_rs256(_base_claims(), issuer="mis-platform")
        result = await get_current_user(
            authorization=f"Bearer {token}",
            x_mis_depts='[{"id":"1001"}]',
            x_mis_orgs='[{"id":"10"}]',
            x_mis_roles='[{"id":"55","code":"hr"},{"id":"56","code":"finance"}]',
        )
        assert result.get("mis") is True
        assert [d["dept_id"] for d in result["departments"]] == ["1001"]
        assert result["primary_department_id"] == "1001"
        assert result["dept_id"] == "1001"
        assert [o["org_id"] for o in result["organizations"]] == ["10"]
        assert [r["role_id"] for r in result["role_infos"]] == ["hr", "finance"]
        assert result["roles"] == ["hr", "finance"]


# ===== T5：端点鉴权（带 / 不带 X-Mis-* 头的 RS256 分支）=====


class TestMisCapabilityEnrichmentEndpoint:
    @pytest.fixture
    def client(self):
        from fastapi.testclient import TestClient
        from src.api.routes import mis_capability as mc
        from src.main import app
        from src.runtime.events import AgentEvent

        fake_session = MagicMock()
        fake_session.session_id = "sess-mock-enr"
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
        ), patch("src.api.deps.get_settings", return_value=_mis_settings()):
            yield TestClient(app)

    def test_chat_with_mis_headers_ok(self, client):
        token = _sign_rs256(_base_claims(), issuer="mis-platform")
        resp = client.post(
            "/api/v1/agents/mis-summary/chat",
            headers={
                "Authorization": f"Bearer {token}",
                "X-Trace-Id": "t-enr",
                "X-Mis-Depts": '[{"id":"1001"}]',
                "X-Mis-Orgs": '[{"id":"10"}]',
                "X-Mis-Roles": '[{"id":"55","code":"hr"}]',
            },
            json={"content": "hi", "role": "user", "metadata": {}},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["code"] == 0

    def test_chat_without_mis_headers_ok(self, client):
        token = _sign_rs256(_base_claims(), issuer="mis-platform")
        resp = client.post(
            "/api/v1/agents/mis-summary/chat",
            headers={"Authorization": f"Bearer {token}", "X-Trace-Id": "t-enr2"},
            json={"content": "hi", "role": "user", "metadata": {}},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["code"] == 0


# ===== T6：DepartmentInfo.org_id（部门属于哪个组织）=====
# 纯加性：仅为 DepartmentInfo 补一个 org_id 元信息，不改 allowed_categories /
# can_approve / primary_department_id 的既有计算逻辑，也不改 department/dept_id。


class TestDepartmentOrgId:
    def test_dept_entry_with_org_id_is_set(self):
        """① 条目自带 orgId → DepartmentInfo.org_id 直接采用。"""
        p = _verified_payload(_base_claims())
        headers = {
            "X-Mis-Depts": '[{"id":"1001","name":"人力资源部","orgId":"10"}]',
            "X-Mis-Orgs": '[{"id":"10"}]',
            "X-Mis-Roles": '[{"id":"55","code":"hr"}]',
        }
        ctx: UserContext = build_user_context(p, headers, _resolver_with_categories())
        assert [d.dept_id for d in ctx.departments] == ["1001"]
        # 条目自带 orgId → 采用，不受 organizations 影响
        assert ctx.departments[0].org_id == "10"

    def test_dept_entry_without_org_id_falls_back_to_primary_org(self):
        """② 条目不带 orgId → 默认取 primary_org_id（organizations[0].org_id）。"""
        p = _verified_payload(_base_claims())
        headers = {
            "X-Mis-Depts": '[{"id":"1001"}]',
            "X-Mis-Orgs": '[{"id":"10"}]',
            "X-Mis-Roles": '[{"id":"55","code":"hr"}]',
        }
        ctx: UserContext = build_user_context(p, headers, _resolver_with_categories())
        assert ctx.primary_org_id == "10"
        # 条目无 orgId → 回落到主组织
        assert ctx.departments[0].org_id == "10"

    def test_no_organizations_org_id_is_none(self):
        """③ 无 organizations 时 org_id 为 None，不崩。"""
        p = _verified_payload(_base_claims())
        headers = {
            "X-Mis-Depts": '[{"id":"1001"}]',
            # 无 X-Mis-Orgs → organizations 为空 → org_id 回落 None
            "X-Mis-Roles": '[{"id":"55","code":"hr"}]',
        }
        ctx: UserContext = build_user_context(p, headers, _resolver_with_categories())
        assert ctx.organizations == []
        assert ctx.primary_org_id is None
        # 无组织则 org_id 为 None，且 dept 仍正确解析
        assert ctx.departments[0].dept_id == "1001"
        assert ctx.departments[0].org_id is None
