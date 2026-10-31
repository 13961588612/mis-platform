"""Coordinator 委派透传与硬委派：跳过收尾 / 首轮 LLM。"""

from __future__ import annotations

from typing import Any

from src.runtime.step_timing import INVOKE_TOOL_NAMES
from src.utils.logging import get_logger

logger = get_logger("coordinator.passthrough")


def extract_passthrough_worker_text(tool_output: str) -> str | None:
    """从 ``agent__invoke`` 成功信封中取出可直出的 Worker 正文。

    仅接受 ``status=completed`` 的 ``text_with_header`` 形态；失败/超时不加头，返回 None。
    """
    text = (tool_output or "").strip()
    if not text.startswith("[task:"):
        return None
    first_line, _, rest = text.partition("\n")
    if "status=completed" not in first_line:
        return None
    body = rest.lstrip("\n").strip()
    return body or None


def should_passthrough_invoke(
    *,
    tool_name: str,
    worker_id: str | None,
    tool_result: dict[str, Any],
    passthrough_workers: frozenset[str],
) -> str | None:
    """若本工具结果应透传，返回 Worker 正文；否则 None。"""
    if tool_name not in INVOKE_TOOL_NAMES:
        return None
    wid = (worker_id or "").strip()
    if not wid or wid not in passthrough_workers:
        return None
    if not tool_result.get("ok"):
        return None
    return extract_passthrough_worker_text(str(tool_result.get("output") or ""))


def should_hard_dispatch(
    *,
    worker_id: str | None,
    hard_dispatch_workers: frozenset[str],
) -> bool:
    """意图预路由命中的 Worker 是否走硬委派（跳过 Coordinator 首轮 LLM）。"""
    wid = (worker_id or "").strip()
    return bool(wid and wid in hard_dispatch_workers)


def build_hard_dispatch_invoke_args(
    *,
    worker_id: str,
    user_text: str,
    intent: str = "",
) -> dict[str, Any]:
    """构造 ``agent__invoke`` 入参（自包含 TaskBrief，无需 Coordinator LLM）。"""
    question = (user_text or "").strip()
    wid = (worker_id or "").strip()
    intent_s = (intent or "").strip()
    goal = f"按用户问题完成查询并直接回复用户：{question}" if question else f"完成对 {wid} 的委派查询"
    return {
        "agent_id": wid,
        "content": question or goal,
        "intent": intent_s,
        "mode": "spawn",
        "task_brief": {
            "goal": goal,
            "purpose": "直接回复用户",
            "inputs": {
                "user_question": question,
                "page_context_slice": {},
                "attachments_text": "",
            },
            "constraints": [
                "仅返回真实存在的数据，无匹配时如实说明",
                "不得臆造业务数据或编码",
            ],
            "expected_output": "text",
        },
    }


async def load_passthrough_workers(coordinator_id: str) -> frozenset[str]:
    """读取 Coordinator ``delegation.passthrough_workers``；失败则空集。"""
    passthrough, _ = await load_delegation_worker_sets(coordinator_id)
    return passthrough


async def load_hard_dispatch_workers(coordinator_id: str) -> frozenset[str]:
    """读取 Coordinator ``delegation.hard_dispatch_workers``；失败则空集。"""
    _, hard = await load_delegation_worker_sets(coordinator_id)
    return hard


async def load_delegation_worker_sets(
    coordinator_id: str,
) -> tuple[frozenset[str], frozenset[str]]:
    """一次读取 ``passthrough_workers`` 与 ``hard_dispatch_workers``。"""
    if not (coordinator_id or "").strip():
        return frozenset(), frozenset()
    try:
        from src.coordinator.coordination_service import read_coordination

        coord = await read_coordination(coordinator_id)
        delegation = coord.delegation
        if delegation is None:
            return frozenset(), frozenset()

        def _set(values: list[str] | None) -> frozenset[str]:
            return frozenset(str(x).strip() for x in (values or []) if str(x).strip())

        return _set(delegation.passthrough_workers), _set(delegation.hard_dispatch_workers)
    except Exception:  # noqa: BLE001 - 配置缺失不阻断主链路
        logger.warning(
            "load delegation worker sets failed",
            coordinator_id=coordinator_id,
            exc_info=True,
        )
        return frozenset(), frozenset()
