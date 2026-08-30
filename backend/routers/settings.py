"""设置相关 API 路由。"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import settings

router = APIRouter()


class SettingsPayload(BaseModel):
    provider: str = ""
    base_url: str = ""
    model: str = ""
    api_key: str = ""


@router.get("/settings")
async def get_settings() -> dict[str, Any]:
    return {"ok": True, "settings": settings.public_settings()}


@router.put("/settings")
async def put_settings(payload: SettingsPayload) -> dict[str, Any]:
    saved = settings.save_settings(payload.model_dump())
    return {"ok": True, "settings": settings.public_settings(), "configured": settings.is_configured()}


@router.post("/settings/test")
async def test_settings() -> dict[str, Any]:
    if not settings.is_configured():
        raise HTTPException(status_code=400, detail="未配置模型或 API Key")
    try:
        from ..llm import _call_openai_compatible

        text = _call_openai_compatible(
            [{"role": "user", "content": "回复 OK"}],
            temperature=0,
            max_tokens=10,
        )
        return {"ok": True, "reply": text}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"连接失败: {e}") from e
