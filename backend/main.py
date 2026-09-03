"""flow-forge — 独立工作流设计引擎（FastAPI 后端 + 根路径 HTML 前端）。

定位：人机通用的智能工作流编排服务。任何入口（人用 Web UI / Agent 走 REST API）
都通过同一套语义引擎驱动「由大模型按流程上下文自动起草、用户/调用方做审阅裁切」。

核心理念（用户反复强调，必须遵守）：
1. 用户绝不打字。画布上拖入的每个模块、连上的每条线，都由大模型根据
   流程上下文自动生成候选描述，用户只从多个候选中挑一个（标推荐项）。
2. 连线自动生成「这条线的作用 + 两模块结合的作用 + 如何注入下一个模块的 Agent」。
3. 虚线只在运行后才出现（表示数据流动），平时用实线表示结构关系。
4. 运行必须真实可执行，不报错。
5. 起点（root）必填 goal：在填满项目总目标前，禁止拖入其它任何模块。
"""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import settings
from .routers import flows, llm, settings as settings_router

BASE_DIR = Path(__file__).resolve().parent.parent

app = FastAPI(title="flow-forge", version="0.5.0")


@app.on_event("startup")
async def _startup() -> None:
    settings.ensure_storage()


# ── 根路径渲染 HTML 前端 ───────────────────────────────────────────
@app.get("/", include_in_schema=False)
async def index() -> FileResponse:
    return FileResponse(BASE_DIR / "web" / "index.html")


# ── 静态资源（css/js）─────────────────────────────────────────────
app.mount("/static", StaticFiles(directory=BASE_DIR / "web"), name="static")


# ── 业务路由 ───────────────────────────────────────────────────────
app.include_router(settings_router.router, prefix="/api")
app.include_router(llm.router, prefix="/api")
app.include_router(flows.router, prefix="/api")


@app.get("/api/health", include_in_schema=False)
async def health() -> JSONResponse:
    return JSONResponse({"ok": True, "name": "flow-forge", "version": "0.5.0"})
