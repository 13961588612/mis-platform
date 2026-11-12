"""委派入参模板补全（无独立精简选人轮）。"""

from __future__ import annotations

from src.coordinator.routing_llm import (
    enrich_invoke_args_with_template,
    invoke_args_need_template,
)


def test_invoke_args_need_template() -> None:
    assert invoke_args_need_template({"agent_id": "spm-report", "content": "hi"})
    assert invoke_args_need_template(
        {"agent_id": "spm-report", "task_brief": {"goal": "短"}}
    )
    assert not invoke_args_need_template(
        {
            "agent_id": "spm-report",
            "task_brief": {
                "goal": "按用户问题完成查询并直接回复用户：宜兴有哪些门店",
                "inputs": {"user_question": "宜兴有哪些门店"},
            },
        }
    )


def test_enrich_fills_task_brief() -> None:
    args = enrich_invoke_args_with_template(
        {"agent_id": "spm-report", "content": "宜兴有哪些门店", "intent": "spm_report"},
        user_text="宜兴有哪些门店",
    )
    brief = args["task_brief"]
    assert brief["inputs"]["user_question"] == "宜兴有哪些门店"
    assert "宜兴" in brief["goal"]
    assert args["intent"] == "spm_report"


def test_enrich_adds_attachments_when_brief_ok() -> None:
    ctx = "【对话上文】\n用户: 宜兴城中店\n助手: 已确认\n【本轮用户】\n各部门销售"
    args = enrich_invoke_args_with_template(
        {
            "agent_id": "spm-report",
            "intent": "spm_report",
            "content": "各部门销售",
            "task_brief": {
                "goal": "按用户问题完成查询并直接回复用户：各部门销售",
                "purpose": "直接回复用户",
                "inputs": {
                    "user_question": "各部门销售",
                    "page_context_slice": {},
                    "attachments_text": "",
                },
                "constraints": [],
                "expected_output": "text",
            },
        },
        user_text="各部门销售",
        conversation_context=ctx,
    )
    assert "宜兴城中店" in args["task_brief"]["inputs"]["attachments_text"]
