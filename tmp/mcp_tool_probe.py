"""Minimal streamable-HTTP MCP tool probe against WrenMcpAgent."""
from __future__ import annotations

import asyncio
import json
import sys

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from mcp.shared._httpx_utils import create_mcp_http_client

URL = "http://10.254.26.37:9101/mcp/1792061562063"
TOKEN = "a39e18c4cc3a7533e86c7fdc3aca8d6f55ae71b7fa5e3408fe01f3de60598efd"
QUESTION = "大统华溧阳城东店 4月销售情况"


async def call(tool: str, args: dict) -> object:
    timeout = httpx.Timeout(connect=5.0, read=60.0, write=30.0, pool=5.0)
    headers = {"Authorization": f"Bearer {TOKEN}"}
    async with create_mcp_http_client(headers=headers, timeout=timeout) as http_client:
        async with streamable_http_client(
            url=URL, http_client=http_client, terminate_on_close=True
        ) as (read, write, _sid):
            async with ClientSession(read, write) as session:
                await session.initialize()
                return await session.call_tool(tool, args)


def content_text(result: object) -> str:
    parts: list[str] = []
    content = getattr(result, "content", None)
    if isinstance(content, list):
        for item in content:
            text = getattr(item, "text", None)
            if text:
                parts.append(str(text))
    return "\n".join(parts)


async def main() -> None:
    out: dict = {"question": QUESTION}
    for tool, args in (
        ("get_context", {"question": QUESTION}),
        ("list_models", {}),
        ("get_instructions", {}),
    ):
        try:
            result = await call(tool, args)
            text = content_text(result)
            out[tool] = {
                "is_error": bool(getattr(result, "isError", False)),
                "text_chars": len(text),
                "text_head": text[:4000],
            }
        except Exception as exc:  # noqa: BLE001
            out[tool] = {"error": f"{type(exc).__name__}: {exc}"}
    path = r"d:\code\mis-platform\tmp\mcp-sale-context.json"
    open(path, "w", encoding="utf-8").write(json.dumps(out, ensure_ascii=False, indent=2))
    print("wrote", path)


if __name__ == "__main__":
    asyncio.run(main())
