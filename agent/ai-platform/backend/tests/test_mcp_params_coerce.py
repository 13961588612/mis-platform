"""MCP callApi params：JSON 字符串应自动反序列化为 object。"""

from __future__ import annotations

import json
from typing import Annotated, Any

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, create_model


def _coerce_json_container(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    text: str = value.strip()
    if not text or text[0] not in "{[":
        return value
    try:
        return json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return value


_JsonObject = Annotated[dict, BeforeValidator(_coerce_json_container)]


def _build_call_api_model() -> type[BaseModel]:
    model_base = type(
        "_McpToolInputBase",
        (BaseModel,),
        {"model_config": ConfigDict(populate_by_name=True)},
    )
    return create_model(
        "CallApiInput",
        __base__=model_base,
        apiName=(str, Field(default=...)),
        params=(_JsonObject | None, Field(default=None)),
    )


def test_coerce_params_json_string_to_object() -> None:
    model = _build_call_api_model()
    parsed = model.model_validate(
        {
            "apiName": "getMemberProfileByMobile",
            "params": '{"mobile":"13900008612"}',
        }
    )
    dump = parsed.model_dump(exclude_none=True)
    assert isinstance(dump["params"], dict)
    assert dump["params"]["mobile"] == "13900008612"


def test_coerce_keeps_object_params() -> None:
    model = _build_call_api_model()
    parsed = model.model_validate(
        {
            "apiName": "getMemberProfileByMobile",
            "params": {"mobile": "15100001716"},
        }
    )
    assert parsed.params == {"mobile": "15100001716"}


def test_coerce_helper_on_array_string() -> None:
    assert _coerce_json_container('["a","b"]') == ["a", "b"]
    assert _coerce_json_container("plain") == "plain"
