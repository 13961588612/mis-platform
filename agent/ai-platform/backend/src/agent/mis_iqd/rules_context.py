"""业务规则上下文提取（knowledge/rules/*.md → NL→SQL 提示词片段）。

<背景>
wren 0.13.3 的 ``get_instructions`` MCP 工具直读工程内 ``knowledge/rules/*.md``
（``wren context instructions`` 同源）。平台把「术语 / 口径 / 业务规则」下发到该文件，
但**此前问数链路从未调用它** —— 规则下发了却不影响生成，等于摆设（2026-09-28 实测）。

本模块只做一件事：把 ``get_instructions`` 的多种返回形态归一成一段可拼进提示词的文本，
并做长度裁剪，避免污染 NL→SQL 上下文。

真机返回形态（连接 900001 实测）::

    {"instructions": "# mis-iqd 平台下发知识\n...", "used_legacy": false}

兼容：``instructions`` 也可能是 list[dict] / list[str] / ``{"items": [...]}``。
"""

from __future__ import annotations

from typing import Any

#: 规则文本上限（字符）。NL→SQL 上下文整体已限 8000，这里留出余量。
MAX_RULES_CHARS: int = 3000


class RuleContext:
    """把 ``get_instructions`` 产物归一为提示词可用的规则文本。"""

    @staticmethod
    def extract(payload: Any) -> str:
        """提取规则正文；无法识别或为空时返回空串（调用方据此跳过该段）。

        Args:
            payload: ``IqdMcpClient.get_instructions()`` 的返回。

        Returns:
            归一后的规则文本（已 strip + 截断）；无内容时 ``""``。
        """
        if payload is None:
            return ""
        if isinstance(payload, str):
            return RuleContext._clip(payload.strip())

        if isinstance(payload, dict):
            for key in ("instructions", "rules", "content", "text"):
                value = payload.get(key)
                text = RuleContext._flatten(value)
                if text:
                    return RuleContext._clip(text)
            # 兜底：{"items": [...]} / {"data": {...}}
            for key in ("items", "data"):
                if key in payload:
                    text = RuleContext.extract(payload.get(key))
                    if text:
                        return text
            return ""

        if isinstance(payload, list):
            text = RuleContext._flatten(payload)
            return RuleContext._clip(text)

        return ""

    @staticmethod
    def _flatten(value: Any) -> str:
        """把 str / list[str|dict] 拍平成文本（dict 取 content/text/rule）。"""
        if isinstance(value, str):
            return value.strip()
        if isinstance(value, dict):
            for key in ("content", "text", "rule", "instructions"):
                inner = value.get(key)
                if isinstance(inner, str) and inner.strip():
                    return inner.strip()
            return ""
        if isinstance(value, list):
            chunks: list[str] = []
            for item in value:
                text = RuleContext._flatten(item)
                if text:
                    chunks.append(text)
            return "\n".join(chunks).strip()
        return ""

    @staticmethod
    def _clip(text: str) -> str:
        """截断超长规则（保留开头，规则文件是「先总则后细则」的组织方式）。"""
        if not text:
            return ""
        if len(text) <= MAX_RULES_CHARS:
            return text
        return text[:MAX_RULES_CHARS].rstrip() + "\n……（规则过长已截断）"
