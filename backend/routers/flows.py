"""流程 API：保存/加载画布、运行流程。"""
from __future__ import annotations

import json
import time
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from .. import llm, settings

router = APIRouter()

DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data"
FLOWS_DIR = DATA_DIR / "flows"


def _ensure() -> None:
    FLOWS_DIR.mkdir(parents=True, exist_ok=True)


def _file(flow_id: str) -> Path:
    _ensure()
    safe = "".join(c for c in flow_id if c.isalnum() or c in "-_")
    return FLOWS_DIR / f"{safe}.json"


class SaveFlowRequest(BaseModel):
    id: str = ""
    name: str = ""
    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []


class RunFlowRequest(BaseModel):
    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []


class DraftFlowRequest(BaseModel):
    goal: str = ""


class TweakFlowRequest(BaseModel):
    goal: str = ""
    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    intent: str = ""


def _topo(nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> list[str]:
    ids = [n["id"] for n in nodes]
    indeg = {i: 0 for i in ids}
    adj: dict[str, list[str]] = {i: [] for i in ids}
    for e in edges:
        if e.get("source") in indeg and e.get("target") in indeg:
            adj[e["source"]].append(e["target"])
            indeg[e["target"]] += 1
    order: list[str] = []
    q = [i for i in ids if indeg[i] == 0]
    while q:
        cur = q.pop(0)
        order.append(cur)
        for nxt in adj[cur]:
            indeg[nxt] -= 1
            if indeg[nxt] == 0:
                q.append(nxt)
    for i in ids:
        if i not in order:
            order.append(i)
    return order


@router.get("/flows")
async def list_flows() -> dict[str, Any]:
    _ensure()
    out = []
    for f in FLOWS_DIR.glob("*.json"):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            out.append({"id": data.get("id", f.stem), "name": data.get("name", f.stem), "nodes": len(data.get("nodes", [])), "edges": len(data.get("edges", []))})
        except (json.JSONDecodeError, OSError):
            continue
    return {"ok": True, "flows": out}


@router.get("/flows/{flow_id}")
async def get_flow(flow_id: str) -> dict[str, Any]:
    f = _file(flow_id)
    if not f.exists():
        return {"ok": False, "error": "not found"}
    return {"ok": True, "flow": json.loads(f.read_text(encoding="utf-8"))}


@router.post("/flows")
async def save_flow(req: SaveFlowRequest) -> dict[str, Any]:
    flow_id = req.id or f"flow-{int(time.time() * 1000)}"
    flow = {"id": flow_id, "name": req.name or flow_id, "nodes": req.nodes, "edges": req.edges}
    _file(flow_id).write_text(json.dumps(flow, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, "id": flow_id}


@router.post("/flows/draft")
async def draft_flow(req: DraftFlowRequest) -> dict[str, Any]:
    """L1：从全局目标起草一整张可运行的图（拓扑 + 节点描述 + 边语义）。"""
    draft = llm.draft_flow(req.goal or "")
    return {"ok": True, **draft}


@router.post("/flows/tweak")
async def tweak_flow(req: TweakFlowRequest) -> dict[str, Any]:
    """L2：根据一句自然语言意图修订当前图 → 返回修订后的图 + 变更说明（可撤销预览）。"""
    out = llm.tweak_flow(req.goal or "", req.nodes or [], req.edges or [], req.intent or "")
    return {"ok": True, **out}


@router.post("/flows/run")
async def run_flow(req: RunFlowRequest) -> dict[str, Any]:
    """按拓扑顺序执行流程。每条边把上游输出注入下游（连线语义的 injection 生效）。"""
    nodes = req.nodes or []
    edges = req.edges or []
    by_id = {n["id"]: n for n in nodes}
    order = _topo(nodes, edges)

    # 上游输出映射（含连线注入说明）
    outputs: dict[str, str] = {}
    edge_map: dict[str, list[dict[str, Any]]] = {}
    for e in edges:
        edge_map.setdefault(e.get("target"), []).append(e)

    results: dict[str, Any] = {}
    for nid in order:
        node = by_id.get(nid)
        if not node:
            continue
        ups = []
        for e in edge_map.get(nid, []):
            src_text = outputs.get(e.get("source"), "")
            inject = (e.get("data") or {}).get("injection") or ""
            ups.append(inject + ("\n" + src_text if src_text else ""))
        res = llm.run_node(node, ups)
        results[nid] = res
        outputs[nid] = res.get("detail") or res.get("summary") or ""

    return {
        "ok": True,
        "run_id": str(uuid.uuid4()),
        "results": results,
        "outputs": outputs,
    }
