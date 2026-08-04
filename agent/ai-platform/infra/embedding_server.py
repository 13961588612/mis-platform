"""Local embedding model service using bge-small-zh-v1.5.

Compatible with SkillIndexer:
  POST /embed {"text": "..."} -> {"embedding": [...], "embeddings": [[...]], ...}
  POST /embed {"texts": ["..."]} -> {"embeddings": [[...]], ...}

Model is loaded at startup (not lazy on first /embed) so health reflects readiness
and a stuck HF download does not block the event loop forever.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger("embedding")

MODEL_NAME = os.environ.get("MODEL_NAME", "BAAI/bge-small-zh-v1.5")
# 本地目录优先（离线）；为空则走 MODEL_NAME（可配合 HF_ENDPOINT 镜像）
MODEL_PATH = os.environ.get("MODEL_PATH", "").strip()
PORT = int(os.environ.get("PORT", "8001"))
MAX_BATCH_SIZE = int(os.environ.get("MAX_BATCH_SIZE", "32"))
CACHE_FOLDER = os.environ.get("SENTENCE_TRANSFORMERS_HOME", "/app/models")

_model = None
_model_error: str | None = None
_model_loading = False


def _resolve_model_source() -> str:
    if MODEL_PATH and os.path.isdir(MODEL_PATH):
        return MODEL_PATH
    return MODEL_NAME


def load_model() -> Any:
    """同步加载模型（应在线程池中调用）。"""
    global _model, _model_error, _model_loading
    if _model is not None:
        return _model
    _model_loading = True
    _model_error = None
    try:
        from sentence_transformers import SentenceTransformer

        source = _resolve_model_source()
        logger.info("Loading embedding model source=%s cache=%s", source, CACHE_FOLDER)
        # local_files_only：仅当 MODEL_PATH 已存在本地目录时强制离线
        local_only = bool(MODEL_PATH and os.path.isdir(MODEL_PATH))
        _model = SentenceTransformer(
            source,
            cache_folder=CACHE_FOLDER,
            local_files_only=local_only,
        )
        # warm-up
        _model.encode(["warmup"], normalize_embeddings=True)
        logger.info("Embedding model ready source=%s", source)
        return _model
    except Exception as exc:
        _model_error = str(exc)
        logger.exception("Failed to load embedding model")
        raise
    finally:
        _model_loading = False


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """启动时预加载模型，失败也不退出进程（health 会标 not_ready）。"""
    try:
        await asyncio.to_thread(load_model)
    except Exception:
        logger.error(
            "Model preload failed; /embed will return 503 until fixed. "
            "Set HF_ENDPOINT (e.g. https://hf-mirror.com) or mount a local model into /app/models."
        )
    yield


app = FastAPI(title="Embedding Service", version="1.1.0", lifespan=lifespan)


class EmbedRequest(BaseModel):
    text: str | None = None
    texts: list[str] | None = None
    batch_size: int = Field(default=MAX_BATCH_SIZE)


@app.get("/health")
async def health() -> dict[str, Any]:
    ready = _model is not None
    status = "ok" if ready else ("loading" if _model_loading else "not_ready")
    body: dict[str, Any] = {
        "status": status,
        "model": MODEL_NAME,
        "ready": ready,
    }
    if _model_error and not ready:
        body["error"] = _model_error[:500]
    # Docker healthcheck: 仅模型就绪时 200
    if not ready:
        raise HTTPException(status_code=503, detail=body)
    return body


@app.post("/embed")
async def embed(request: EmbedRequest) -> dict[str, Any]:
    if request.text is not None:
        texts = [request.text]
    elif request.texts:
        texts = request.texts
    else:
        raise HTTPException(status_code=422, detail="Provide text or texts")

    batch_size = min(request.batch_size or MAX_BATCH_SIZE, MAX_BATCH_SIZE)
    texts = texts[:batch_size]

    try:
        model = await asyncio.to_thread(load_model)
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Embedding model unavailable: {exc}",
        ) from exc

    start = time.perf_counter()
    vectors = await asyncio.to_thread(
        lambda: model.encode(texts, normalize_embeddings=True),
    )
    elapsed = (time.perf_counter() - start) * 1000
    embeddings = vectors.tolist()

    return {
        "embedding": embeddings[0] if len(embeddings) == 1 else None,
        "embeddings": embeddings,
        "dimension": len(embeddings[0]) if embeddings else 0,
        "model": MODEL_NAME,
        "elapsed_ms": round(elapsed, 2),
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT)
