"""NL→SQL 生成器 — 经平台 LLM Gateway 把自然语言转为 SQL。

WrenAI OSS 0.13 的 MCP ``dry_plan`` 仅做「已建模 SQL → 方言转译」，**不**接收自然语言。
问数链路因此在本模块完成 NL→SQL，再交给 Wren ``dry_plan`` / ``dry_run`` / ``run_sql``。

设计要点：
- 复用 :func:`get_llm_gateway`（与 Coordinator / SkillBuilder 同一套接入）；
- 输出严格约束为 SQL（或 GENERAL），禁止编造业务数字；
- ``mock=True`` 时不调 LLM，返回固定 SQL，供 Golden path / 单测离线跑通。
"""

from __future__ import annotations

import json
import re
from typing import Any

from src.config import get_settings
from src.llm.gateway import get_llm_gateway
from src.llm.models import LLMMessage, LLMRequest, LLMRole
from src.utils.logging import get_logger

logger = get_logger("agent.mis_iqd.nl2sql")

_SQL_FENCE_RE = re.compile(
    r"```(?:sql|SQL)?\s*\n?(.*?)```",
    re.DOTALL,
)

_SYSTEM_PROMPT = """你是企业问数系统的 Text-to-SQL 引擎。
根据用户问题与给定的语义模型上下文，生成可在 WrenAI / DataFusion 系引擎执行的 SELECT SQL。

硬性规则：
1. 只输出 JSON 对象，不要 Markdown 解释，不要代码围栏外的散文。
2. 数据类问题：{"type":"text_to_sql","sql":"<单条 SELECT SQL>"}
3. GENERAL 仅用于明显与数据无关的内容（寒暄、闲聊、纯编程求助等）：
   {"type":"GENERAL","summary":"<简短中文说明>"}
4. 若 allowed_tables / available_models 非空，且问题涉及查询/统计/汇总/对比/明细/金额/数量/排名/趋势等，
   **必须**返回 text_to_sql。
5. FROM/JOIN 只能使用上下文给出的 **MDL 模型名**（available_models / model 块的 name），
   不要写 datasource.schema.table 物理路径（如 pg_main.public.orders）。
6. **列名必须严格来自对应 model 的 columns 清单**；禁止臆造 dt/ds/biz_date 等未列出的字段。
   日期过滤只能用清单里真实存在的日期列（如 ord_date、created_at）。
7. 只生成只读 SELECT（可含 WITH）；禁止 INSERT/UPDATE/DELETE/DDL/多语句。
8. 不要加行级权限谓词（由平台后续注入）。
9. **日期函数方言（关键）**：目标引擎是 DataFusion，不是完整 Postgres。
   - 禁止 date_trunc / date_part / make_date / INTERVAL 'x month' 等 PG 专用写法。
   - 若日期列类型为 VARCHAR/STRING（常见于 ord_date），用字符串范围比较，例如：
     `ord_date >= '2026-04-01' AND ord_date < '2026-07-01'`（上季度）。
   - 若确需按月截断且列为真正时间类型，可用 `CAST(col AS DATE)` + 字面量边界，仍避免 date_trunc。
"""


class Nl2SqlResult:
    """NL→SQL 一次生成结果。"""

    def __init__(
        self,
        *,
        type: str,
        sql: str = "",
        summary: str = "",
        raw: str = "",
        prompt_system: str = "",
        prompt_user: str = "",
    ) -> None:
        self.type = type
        self.sql = sql
        self.summary = summary
        self.raw = raw
        self.prompt_system = prompt_system
        self.prompt_user = prompt_user


class Nl2SqlGenerator:
    """经 LLM Gateway 生成 SQL。

    Args:
        gateway: 可注入的 LLM Gateway（缺省 :func:`get_llm_gateway`）。
        mock: 离线模式，不调 LLM，返回固定 SQL。
        model: 覆盖默认主模型；``None`` 时用 ``Settings.LLM_PRIMARY_MODEL``。
    """

    def __init__(
        self,
        *,
        gateway: Any | None = None,
        mock: bool = False,
        model: str | None = None,
    ) -> None:
        self._gateway = gateway
        self._mock = mock
        self._model = model

    async def generate(
        self,
        *,
        question: str,
        context: str = "",
        allowed_tables: list[str] | None = None,
        language: str = "zh-CN",
        user_id: str = "",
        session_id: str = "",
        repair_hint: str = "",
    ) -> Nl2SqlResult:
        """把自然语言问题转为 SQL（或不支持说明）。

        Args:
            repair_hint: 上一轮 dry_run/执行失败信息；非空时要求模型修正 SQL。
        """
        if self._mock:
            return self._mock_result(question, allowed_tables)

        settings = get_settings()
        model = self._model or settings.LLM_PRIMARY_MODEL
        user_payload = self._build_user_payload(
            question=question,
            context=context,
            allowed_tables=allowed_tables,
            language=language,
            repair_hint=repair_hint,
        )
        request = LLMRequest(
            messages=[
                LLMMessage(role=LLMRole.SYSTEM, content=_SYSTEM_PROMPT),
                LLMMessage(role=LLMRole.USER, content=user_payload),
            ],
            model=model,
            temperature=0.1,
            max_tokens=2048,
            user_id=user_id,
            session_id=session_id,
        )
        gateway = self._gateway if self._gateway is not None else get_llm_gateway()
        response = await gateway.chat(request)
        content = (getattr(response, "content", None) or "").strip()
        parsed = self._parse_response(content)
        parsed.prompt_system = _SYSTEM_PROMPT
        parsed.prompt_user = user_payload
        logger.info(
            "IQD nl2sql llm io",
            model=model,
            user_chars=len(user_payload),
            raw_chars=len(content),
            out_type=parsed.type,
            has_sql=bool(parsed.sql),
        )
        return parsed

    @staticmethod
    def _build_user_payload(
        *,
        question: str,
        context: str,
        allowed_tables: list[str] | None,
        language: str,
        repair_hint: str = "",
    ) -> str:
        tables = allowed_tables or []
        parts = [
            f"language: {language}",
            f"question: {question}",
            "allowed_tables:",
            json.dumps(tables, ensure_ascii=False),
            "semantic_context:",
            context.strip() or "(empty)",
        ]
        if repair_hint.strip():
            parts.extend(
                [
                    "previous_sql_error (fix and regenerate valid SQL using only listed columns):",
                    repair_hint.strip()[:1500],
                ]
            )
        return "\n".join(parts)

    def _parse_response(self, content: str) -> Nl2SqlResult:
        """解析模型输出为 Nl2SqlResult；兼容 JSON / SQL 围栏 / 纯 SQL。"""
        raw = content.strip()
        if not raw:
            return Nl2SqlResult(type="text_to_sql", sql="", raw=raw)

        # 1) 尝试 JSON（可剥围栏）
        candidate = raw
        fence = _SQL_FENCE_RE.search(raw)
        if fence and not raw.lstrip().startswith("{"):
            # 纯 SQL 围栏
            sql = fence.group(1).strip().rstrip(";")
            return Nl2SqlResult(type="text_to_sql", sql=sql, raw=raw)

        if candidate.startswith("```"):
            # ```json ... ```
            inner = candidate[3:]
            nl = inner.find("\n")
            if nl != -1:
                inner = inner[nl + 1 :]
            end = inner.rfind("```")
            if end != -1:
                inner = inner[:end]
            candidate = inner.strip()

        try:
            parsed: Any = json.loads(candidate)
            if isinstance(parsed, dict):
                qtype = str(parsed.get("type") or "text_to_sql").strip() or "text_to_sql"
                if qtype.upper() == "GENERAL":
                    return Nl2SqlResult(
                        type="GENERAL",
                        summary=str(
                            parsed.get("summary") or parsed.get("answer") or ""
                        ).strip(),
                        raw=raw,
                    )
                sql = str(parsed.get("sql") or "").strip().rstrip(";")
                return Nl2SqlResult(type="text_to_sql", sql=sql, raw=raw)
        except (json.JSONDecodeError, TypeError):
            pass

        # 2) 裸 SQL
        sql = raw
        if fence:
            sql = fence.group(1)
        sql = sql.strip().rstrip(";")
        # 去掉可能残留的解释行：取首个 SELECT/WITH
        upper = sql.upper()
        for marker in ("WITH ", "SELECT "):
            idx = upper.find(marker)
            if idx >= 0:
                sql = sql[idx:]
                break
        return Nl2SqlResult(type="text_to_sql", sql=sql.strip().rstrip(";"), raw=raw)

    @staticmethod
    def _mock_result(
        question: str,
        allowed_tables: list[str] | None,
    ) -> Nl2SqlResult:
        """离线固定 SQL（与历史 MCP mock plan 对齐，便于 Golden path）。"""
        _ = question, allowed_tables
        mock_sql = (
            "SELECT channel, SUM(total_amount) AS gmv "
            "FROM pg_main.public.orders "
            "WHERE created_at >= date_trunc('month', CURRENT_DATE) "
            "GROUP BY channel ORDER BY gmv DESC"
        )
        return Nl2SqlResult(
            type="text_to_sql",
            sql=mock_sql,
            raw="mock",
            prompt_system=_SYSTEM_PROMPT,
            prompt_user=f"question: {question}\nallowed_tables: {allowed_tables or []}",
        )
