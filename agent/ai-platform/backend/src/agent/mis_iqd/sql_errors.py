"""问数 SQL / 基础设施错误的识别正则与文本提取。

**为什么单独成模块**：这些正则原先定义在 ``orchestrator``，但连接看门狗
（:mod:`src.agent.mis_iqd.mcp_watchdog`）也要用；而 orchestrator 又需要导入看门狗。
放在中立模块即可消除循环导入。

判定分三类：

- **列错误 / DataFusion 方言错误** ⇒ *可修复*：允许带 repair_hint 重生成一次 SQL；
- **基础设施错误**（连接失效 / 超时）⇒ *不可修复*：重生成没有意义，应 fail-fast，
  并按「服务暂不可用」定级；这也是连接看门狗触发重启的信号；
- 其它 ⇒ 按不可修复处理（保守）。
"""

from __future__ import annotations

import re

#: dry_run / 引擎报「列不存在」或可修复的方言错误时，触发一次 NL→SQL 重生成。
COLUMN_ERROR_RE = re.compile(
    r"(column\s+'[^']+'\s+cannot\s+be\s+resolved)"
    r"|(unknown\s+column)"
    r"|(no\s+such\s+column)"
    r"|(field\s+not\s+found)"
    r"|(无法识别\s*'[^']+'\s*列)"
    r"|('\w+'\s+is\s+not\s+a\s+valid)",
    re.IGNORECASE,
)

#: DataFusion 不支持的 PG 方言 / 类型错误（可修一次）。
#:
#: ⚠️ 这里**不能**放 ``GENERIC_USER_ERROR``：那是 wren 的通用兜底错误码，既可能
#: 包裹方言问题，也可能包裹连接/权限/超时。把它当「可修复」会让连接中断这类基础
#: 设施故障触发一次毫无意义的 NL→SQL 重生成（白烧 3~5s 与 token，最终还是失败）。
#: 基础设施错误由 :data:`INFRA_ERROR_RE` 单独识别、直接 fail-fast。
DIALECT_ERROR_RE = re.compile(
    r"(date_trunc)"
    r"|(date_part)"
    r"|(unsupported\s+function)"
    r"|(not\s+implemented)"
    r"|(type\s+mismatch)"
    r"|(cannot\s+cast)",
    re.IGNORECASE,
)

#: 基础设施 / 连接类错误（**不可修复**）：既不该触发 SQL 重生成，也不该报
#: 「未能生成有效查询」（45205，暗示用户换说法）。应与 WrenAI 不可达同档，
#: 报 45202「问数服务暂不可用，请稍后重试」。
#:
#: 典型来源：MySQL 协议 ``(2006, 'Server has gone away')``、连接被拒/重置、
#: 读超时、wren 预检阶段（``phase=SQL_DRY_RUN``）抛出的通用错误。
INFRA_ERROR_RE = re.compile(
    r"(server\s+has\s+gone\s+away)"
    r"|(lost\s+connection)"
    r"|(connection\s+refused)"
    r"|(connection\s+reset)"
    r"|(can't\s+connect)"
    r"|(broken\s+pipe)"
    r"|(read\s+timeout)"
    r"|(connect\s+timeout)"
    r"|(phase=SQL_DRY_RUN)",
    re.IGNORECASE,
)


def sql_error_text(exc: BaseException) -> str:
    """把异常里可能承载错误细节的属性拼成一段可匹配文本。

    wren MCP 的错误可能挂在 ``str(exc)``、``payload``、``body``、``detail``
    任一处，只看 ``str()`` 会漏判（历史上 ``phase=SQL_DRY_RUN`` 就只在 detail 里）。
    """
    text = str(exc) or ""
    for attr in ("payload", "body", "detail"):
        extra = getattr(exc, attr, None)
        if extra is not None:
            text = f"{text} {extra}"
    return text


def is_repairable_sql_error(exc: BaseException) -> bool:
    """列错误或 DataFusion 方言错误 → 允许带 repair_hint 重生成一次。

    <b>先判基础设施错误</b>：连接中断 / 超时 / wren 预检通用错误等**绝不可修复**，
    重生成 SQL 只会白烧一次 LLM 调用（故障期实测多耗 3~5s，且必然再次失败）。
    """
    text = sql_error_text(exc)
    if INFRA_ERROR_RE.search(text):
        return False
    return bool(COLUMN_ERROR_RE.search(text) or DIALECT_ERROR_RE.search(text))


def is_infra_error(exc: BaseException) -> bool:
    """是否基础设施 / 连接类错误（据此把错误码归到 45202 而非 45205）。"""
    return bool(INFRA_ERROR_RE.search(sql_error_text(exc)))
