"""452xx 错误码定义（v1.9 / B2，architecture §7.2）。

在 Python 侧登记问数专属错误码段：``45200`` 段共 8 个（45201–45208）。
常量名对齐架构表；前端按 code 映射降级文案。**降级铁律（NFR-2）**：任何错误
都不得由 LLM 兜底编造数据，Worker ``system.md`` 已显式声明。

错误码表：
- ``45201 WRENAI_NOT_CONFIGURED``        未配置或无 enabled 连接
- ``45202 WRENAI_UNREACHABLE``           WrenAI 不可达/5xx
- ``45203 WRENAI_TIMEOUT``               轮询超上限
- ``45204 WRENAI_SCOPE_DENIED``          数据范围裁定拒绝（前置或后置）
- ``45205 WRENAI_SQL_FAILED``            WrenAI 返回 failed/correcting 耗尽
- ``45206 WRENAI_QUESTION_UNSUPPORTED``  type=GENERAL，非数据类问题
- ``45207 WRENAI_MDL_SYNC_FAILED``       建模同步失败
- ``45208 WRENAI_ENHANCE_SYNC_PARTIAL``  增强同步部分失败
"""

from __future__ import annotations

from typing import Any


# ===== 错误码常量（与架构 §7.2 一一对应）=====

WRENAI_NOT_CONFIGURED = 45201
WRENAI_UNREACHABLE = 45202
WRENAI_TIMEOUT = 45203
WRENAI_SCOPE_DENIED = 45204
WRENAI_SQL_FAILED = 45205
WRENAI_QUESTION_UNSUPPORTED = 45206
WRENAI_MDL_SYNC_FAILED = 45207
WRENAI_ENHANCE_SYNC_PARTIAL = 45208

#: 错误码 → 人类可读文案（供 SSE error 帧 / 降级展示；前端可覆盖）
ERROR_CODE_MESSAGES: dict[int, str] = {
    WRENAI_NOT_CONFIGURED: "问数服务未配置，请联系管理员",
    WRENAI_UNREACHABLE: "问数服务暂不可用，请稍后重试",
    WRENAI_TIMEOUT: "本次查询超时，请缩小问题范围",
    WRENAI_SCOPE_DENIED: "当前角色无权查询相关数据",
    WRENAI_SQL_FAILED: "未能生成有效查询，请换个说法",
    WRENAI_QUESTION_UNSUPPORTED: "该问题不是数据类问题，无法生成查询",
    WRENAI_MDL_SYNC_FAILED: "语义建模同步失败，请检查连接后重试",
    WRENAI_ENHANCE_SYNC_PARTIAL: "增强物料同步部分失败，请查看失败明细",
}

#: 反向映射：错误码字符串（如 "45204"）→ 码
ERROR_CODE_BY_NAME: dict[str, int] = {
    "WRENAI_NOT_CONFIGURED": WRENAI_NOT_CONFIGURED,
    "WRENAI_UNREACHABLE": WRENAI_UNREACHABLE,
    "WRENAI_TIMEOUT": WRENAI_TIMEOUT,
    "WRENAI_SCOPE_DENIED": WRENAI_SCOPE_DENIED,
    "WRENAI_SQL_FAILED": WRENAI_SQL_FAILED,
    "WRENAI_QUESTION_UNSUPPORTED": WRENAI_QUESTION_UNSUPPORTED,
    "WRENAI_MDL_SYNC_FAILED": WRENAI_MDL_SYNC_FAILED,
    "WRENAI_ENHANCE_SYNC_PARTIAL": WRENAI_ENHANCE_SYNC_PARTIAL,
}


def error_message(code: int) -> str:
    """返回错误码对应文案；未知码返回通用文案。"""
    return ERROR_CODE_MESSAGES.get(code, "问数服务处理失败")


class IqdError(Exception):
    """问数领域错误基类（携带 452xx 码）。"""

    def __init__(self, code: int, message: str | None = None, *, detail: Any = None) -> None:
        """初始化错误码与文案。

        Args:
            code: 452xx 错误码。
            message: 覆盖默认文案；缺省取 :func:`error_message`。
            detail: 附加调试信息（不进用户可见文案）。
        """
        super().__init__(message or error_message(code))
        self.code = code
        self.message = message or error_message(code)
        self.detail = detail

    def to_error_payload(self) -> dict[str, Any]:
        """序列化为 SSE error 帧 data（``{code, message}``）。"""
        return {"code": self.code, "message": self.message}


class ScopeDeniedError(IqdError):
    """数据范围裁定拒绝（45204；前置或后置，不透露表名）。"""

    def __init__(self, message: str | None = None) -> None:
        """设置 45204 与默认「无权」文案。"""
        super().__init__(WRENAI_SCOPE_DENIED, message)


class WrenaiNotConfiguredError(IqdError):
    """未配置或无 enabled 连接（45201）。"""

    def __init__(self, message: str | None = None) -> None:
        """设置 45201 与默认「未配置」文案。"""
        super().__init__(WRENAI_NOT_CONFIGURED, message)


class WrenaiUnreachableError(IqdError):
    """WrenAI 不可达/5xx（45202）。"""

    def __init__(self, message: str | None = None) -> None:
        """设置 45202 与默认「暂不可用」文案。"""
        super().__init__(WRENAI_UNREACHABLE, message)


class WrenaiTimeoutError(IqdError):
    """轮询/工具调用超上限（45203）。"""

    def __init__(self, message: str | None = None) -> None:
        """设置 45203 与默认「超时」文案。"""
        super().__init__(WRENAI_TIMEOUT, message)


class SqlFailedError(IqdError):
    """WrenAI 返回 failed/correcting 耗尽（45205）。"""

    def __init__(self, message: str | None = None) -> None:
        """设置 45205 与默认「未能生成有效查询」文案。"""
        super().__init__(WRENAI_SQL_FAILED, message)


class QuestionUnsupportedError(IqdError):
    """type=GENERAL，非数据类问题（45206；直接展示 summary 不报错）。"""

    def __init__(self, message: str | None = None, *, summary: str = "") -> None:
        """设置 45206 文案；``summary`` 供前端直接展示。"""
        super().__init__(WRENAI_QUESTION_UNSUPPORTED, message)
        self.summary = summary
