"""Local embedding model service using bge-small-zh-v1.5.

Compatible with SkillIndexer:
  POST /embed {"text": "..."} -> {"embedding": [...], "embeddings": [[...]], ...}
  POST /embed {"texts": ["..."]} -> {"embeddings": [[...]], ...}
"""

from __future__ import annotations

import os
import time
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

MODEL_NAME = os.environ.get("MODEL_NAME", "BAAI/bge-small-zh-v1.5")
PORT = int(os.environ.get("PORT", "8001"))
MAX_BATCH_SIZE = int(os.environ.get("MAX_BATCH_SIZE", "32"))

app = FastAPI(title="Embedding Service", version="1.0.0")
_model = None


def get_model():
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer

        _model = SentenceTransformer(MODEL_NAME, cache_folder="/app/models")
    return _model


class EmbedRequest(BaseModel):
    text: str | None = None
    texts: list[str] | None = None
    batch_size: int = Field(default=MAX_BATCH_SIZE)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "model": MODEL_NAME}


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

    start = time.perf_counter()
    model = get_model()
    vectors = model.encode(texts, normalize_embeddings=True)
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
