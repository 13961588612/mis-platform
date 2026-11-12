"""Upload s1-store-sales-sql-pairs.json into live iqd (bg-data).

Usage:
  $env:MIS_TOKEN='...'
  python docs/ai-fusion/bgbh-analyst/samples/upload_sql_pairs.py
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

BASE = "http://10.254.26.34/api/v1/iqd"
SEED = Path(__file__).with_name("s1-store-sales-sql-pairs.json")


def main() -> int:
    token = os.environ.get("MIS_TOKEN", "").strip()
    if not token:
        print("MISSING MIS_TOKEN", file=sys.stderr)
        return 2
    seed = json.loads(SEED.read_text(encoding="utf-8"))
    conn_id = int(seed["connection_id"])
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

    def call(method: str, path: str, body: dict | None = None) -> dict:
        data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(
            f"{BASE}{path}",
            data=data,
            headers=headers,
            method=method,
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"{method} {path} -> HTTP {exc.code}: {raw[:500]}") from exc

    tree = call("GET", f"/sql-pair-categories/tree?connectionId={conn_id}")
    if tree.get("code") not in (0, None):
        raise RuntimeError(f"list tree failed: {tree}")

    def flatten(nodes: list, out: dict) -> None:
        for n in nodes or []:
            out[str(n.get("code"))] = n
            flatten(n.get("children") or [], out)

    by_code: dict = {}
    flatten(tree.get("data") or [], by_code)

    parent_cfg = seed.get("parent_category") or {}
    parent_code = str(parent_cfg.get("code") or "05")
    parent = by_code.get(parent_code)
    if parent is None:
        # fallback by name
        for n in by_code.values():
            if n.get("name") == parent_cfg.get("name"):
                parent = n
                break
    if parent is None:
        raise RuntimeError(f"parent category not found: code={parent_code}")

    parent_id = parent.get("id")
    print(f"parent id={parent_id} code={parent.get('code')} name={parent.get('name')}")

    code_to_id: dict[str, int] = {parent_code: int(parent_id)}
    for child in seed.get("categories") or []:
        code = str(child["code"])
        existing = by_code.get(code)
        if existing and str(existing.get("parent_id") or existing.get("parentId") or "") in (
            str(parent_id),
            "",
        ):
            # accept if already under parent or code unique
            code_to_id[code] = int(existing["id"])
            print(f"reuse child id={existing['id']} code={code} name={existing.get('name')}")
            continue
        if existing:
            code_to_id[code] = int(existing["id"])
            print(f"reuse existing code={code} id={existing['id']} name={existing.get('name')}")
            continue
        body = {
            "connection_id": conn_id,
            "parent_id": parent_id,
            "code": code,
            "name": child["name"],
            "sort_order": child.get("sort_order", 0),
            "enabled": True,
        }
        created = call("POST", "/sql-pair-categories", body)
        if created.get("code") not in (0, None):
            raise RuntimeError(f"create category {code} failed: {created}")
        data = created.get("data") or {}
        code_to_id[code] = int(data["id"])
        print(f"created child id={data['id']} code={code} name={data.get('name')}")

    ok = 0
    fail = 0
    for pair in seed.get("pairs") or []:
        cat_code = str(pair["category_code"])
        cat_id = code_to_id.get(cat_code)
        if cat_id is None:
            print(f"SKIP missing category {cat_code}: {pair.get('question')}")
            fail += 1
            continue
        sql = pair["wren_sql"]
        body = {
            "connection_id": conn_id,
            "category_id": cat_id,
            "question": pair["question"],
            "source_dialect": "mysql",
            "native_sql": sql,
            "wren_sql": sql,
            "remark": pair.get("remark"),
            "enabled": True,
        }
        try:
            res = call("POST", "/sql-pairs", body)
            if res.get("code") not in (0, None):
                print(f"FAIL {pair.get('remark')}: {res}")
                fail += 1
                continue
            data = res.get("data") or {}
            print(f"OK id={data.get('id')} [{pair.get('remark')}] {pair.get('question')}")
            ok += 1
        except Exception as exc:  # noqa: BLE001
            print(f"FAIL {pair.get('remark')}: {exc}")
            fail += 1

    print(f"DONE ok={ok} fail={fail}")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
