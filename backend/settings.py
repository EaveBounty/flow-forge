"""设置存储：模型厂商 / 模型 / API Key。

API Key 存于本地 data/settings.json，仅本机服务读取。绝不写入仓库/日志。
支持环境变量覆盖（便于外部调用方或 CI 注入）：
  FLOW_FORGE_PROVIDER / FLOW_FORGE_MODEL / FLOW_FORGE_API_KEY
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
SETTINGS_FILE = DATA_DIR / "settings.json"

DEFAULT_SETTINGS: dict[str, Any] = {
    "provider": "",       # e.g. "openai" | "deepseek" | "openai-compatible" | ""
    "base_url": "",       # optional custom base URL for openai-compatible
    "model": "",
    "api_key": "",
}


def ensure_storage() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not SETTINGS_FILE.exists():
        _write({**DEFAULT_SETTINGS})


def _read() -> dict[str, Any]:
    if not SETTINGS_FILE.exists():
        return {**DEFAULT_SETTINGS}
    try:
        data = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {**DEFAULT_SETTINGS}
    merged = {**DEFAULT_SETTINGS, **(data if isinstance(data, dict) else {})}
    return merged


def _write(data: dict[str, Any]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    SETTINGS_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def get_settings() -> dict[str, Any]:
    s = _read()
    # 环境变量优先（用于无盘注入）
    return {
        "provider": os.environ.get("FLOW_FORGE_PROVIDER", s.get("provider", "")),
        "base_url": os.environ.get("FLOW_FORGE_BASE_URL", s.get("base_url", "")),
        "model": os.environ.get("FLOW_FORGE_MODEL", s.get("model", "")),
        "api_key": os.environ.get("FLOW_FORGE_API_KEY", s.get("api_key", "")),
    }


def save_settings(payload: dict[str, Any]) -> dict[str, Any]:
    s = _read()
    for key in ("provider", "base_url", "model", "api_key"):
        if key in payload:
            s[key] = str(payload[key]).strip()
    _write(s)
    return s


def is_configured() -> bool:
    s = get_settings()
    return bool(s.get("api_key")) and bool(s.get("model"))


def public_settings() -> dict[str, Any]:
    """对外暴露（不泄露 api_key 明文，只给 has_key）。"""
    s = get_settings()
    return {
        "provider": s.get("provider", ""),
        "base_url": s.get("base_url", ""),
        "model": s.get("model", ""),
        "has_key": bool(s.get("api_key")),
    }
