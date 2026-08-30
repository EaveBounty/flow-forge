"""LLM 生成类 API：模块候选 / 连线语义。"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from .. import llm

router = APIRouter()


class ModuleGenRequest(BaseModel):
    kind: str = "action"
    ctx: dict[str, Any] = {}


class EdgeSemRequest(BaseModel):
    from_module: dict[str, Any] = {}
    to_module: dict[str, Any] = {}


@router.post("/module/generate")
async def generate_module(req: ModuleGenRequest) -> dict[str, Any]:
    candidates = llm.generate_module_candidates(req.kind or "action", req.ctx or {})
    return {"ok": True, "kind": req.kind, "candidates": candidates}


@router.post("/edge/semantic")
async def edge_semantic(req: EdgeSemRequest) -> dict[str, Any]:
    sem = llm.generate_edge_semantics(req.from_module, req.to_module)
    return {"ok": True, **sem}
