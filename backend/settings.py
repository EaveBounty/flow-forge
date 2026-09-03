"""集中配置层：把「设置页写入」与「直接编辑 JSON」做成等价。

配置来源（优先级从低到高合并）：
  1) 内置默认值 DEFAULT_LLM
  2) flowforge.config.json  —— 仓库根的可提交工程配置（非敏感项，团队共享，绝不含 api_key）
  3) data/settings.json     —— 本机私有层（仅存 api_key；可含本地覆盖）
  4) 环境变量 FLOW_FORGE_*   —— 运行时最高优先（便于外部调用方/Agent/CI 注入）

save_settings 会自动把非敏感项写入 flowforge.config.json（可提交、可版本化），
把 api_key 仅写入 data/settings.json（已 gitignore）。因此：
  · Web 设置页保存 == 直接编辑 flowforge.config.json（等价）
  · api_key 永不进入可提交文件
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
PROJECT_CONFIG_FILE = BASE_DIR / "flowforge.config.json"  # 可提交（无密钥）
LOCAL_FILE = DATA_DIR / "settings.json"                   # 仅本机（含密钥）

# 可提交配置里允许出现的键（其它键一律忽略/剥离，杜绝密钥写入）
COMMITTABLE_KEYS = ("provider", "base_url", "model", "system_prompt")
# 私有层键（含密钥）
LOCAL_KEYS = ("api_key",)

DEFAULT_LLM: dict[str, Any] = {
    "provider": "",       # "openai" | "deepseek" | "openai-compatible" | ""
    "base_url": "",       # optional custom base URL
    "model": "",
    "system_prompt": "",  # 可选：默认系统提示词（工程级）
    "api_key": "",
}


def ensure_storage() -> None:
    """确保可提交配置文件存在（用默认值生成，不含密钥）；本地目录就绪。

    v0.4.0 曾把所有配置存于 data/settings.json。这里做一次性迁移：新建可提交
    文件时，若旧本地文件里已有非敏感配置（provider/base_url/model/system_prompt），
    则把它们搬进可提交文件，避免升级后模型丢失。api_key 始终留在本地层。
    """
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    legacy = _read_json(LOCAL_FILE)
    if not PROJECT_CONFIG_FILE.exists():
        seed = {k: DEFAULT_LLM[k] for k in COMMITTABLE_KEYS}
        for k in COMMITTABLE_KEYS:
            if legacy.get(k):
                seed[k] = legacy[k]
        _write_committable(seed)
    # 把仍残留于本地文件的非敏感键搬到可提交层（幂等，仅迁移非空且非默认）
    leftover = {k: v for k, v in legacy.items() if k in COMMITTABLE_KEYS and v}
    if leftover:
        _write_committable(leftover)
    if not LOCAL_FILE.exists():
        _write_local({})
    # 清理：本地层只保留 api_key，去掉遗留的非敏感键
    clean_local = {k: v for k, v in _read_json(LOCAL_FILE).items() if k in LOCAL_KEYS}
    LOCAL_FILE.write_text(json.dumps(clean_local, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


# ── 各层读写 ─────────────────────────────────────────────────────────
def _read_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, OSError):
        return {}


def _write_committable(data: dict[str, Any]) -> None:
    cur = _read_json(PROJECT_CONFIG_FILE)
    merged = {**cur, **{k: data[k] for k in COMMITTABLE_KEYS if k in data}}
    # 只保留可提交键，杜绝密钥混入
    merged = {k: v for k, v in merged.items() if k in COMMITTABLE_KEYS}
    PROJECT_CONFIG_FILE.write_text(json.dumps(merged, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _write_local(data: dict[str, Any]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    cur = _read_json(LOCAL_FILE)
    # 本地层只保留 api_key（LOCAL_KEYS），不接收/不保留任何非敏感键
    merged = {k: v for k, v in cur.items() if k in LOCAL_KEYS}
    for k in LOCAL_KEYS:
        if k in data:
            merged[k] = str(data[k]).strip()
    # api_key 为空则视为清除
    if "api_key" in merged and not merged["api_key"]:
        merged.pop("api_key", None)
    LOCAL_FILE.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")


def _merge_resolve() -> dict[str, Any]:
    """解析后的完整配置（含 api_key），供内部调用。"""
    merged: dict[str, Any] = {**DEFAULT_LLM}
    # 1) 可提交工程配置
    for k, v in _read_json(PROJECT_CONFIG_FILE).items():
        if k in COMMITTABLE_KEYS:
            merged[k] = v
    # 2) 本地私有（api_key）
    for k, v in _read_json(LOCAL_FILE).items():
        if k in LOCAL_KEYS:
            merged[k] = v
    # 3) 环境变量最高优先
    env_map = {
        "FLOW_FORGE_PROVIDER": "provider",
        "FLOW_FORGE_BASE_URL": "base_url",
        "FLOW_FORGE_MODEL": "model",
        "FLOW_FORGE_SYSTEM_PROMPT": "system_prompt",
        "FLOW_FORGE_API_KEY": "api_key",
    }
    for envk, cfgk in env_map.items():
        val = os.environ.get(envk)
        if val:
            merged[cfgk] = val
    return merged


def get_settings() -> dict[str, Any]:
    return _merge_resolve()


def save_settings(payload: dict[str, Any]) -> dict[str, Any]:
    """按字段类型分流写入：非敏感→可提交；api_key→本地。返回值=解析后配置。"""
    payload = payload or {}
    committable = {k: str(payload[k]).strip() for k in COMMITTABLE_KEYS if k in payload}
    if committable:
        _write_committable(committable)
    if "api_key" in payload:
        _write_local({"api_key": str(payload["api_key"]).strip()})
    return _merge_resolve()


def is_configured() -> bool:
    s = get_settings()
    return bool(s.get("api_key")) and bool(s.get("model"))


def public_settings() -> dict[str, Any]:
    """对外暴露（不泄露 api_key 明文，只给 has_key）；附配置来源信息便于排查。"""
    s = get_settings()
    return {
        "provider": s.get("provider", ""),
        "base_url": s.get("base_url", ""),
        "model": s.get("model", ""),
        "has_key": bool(s.get("api_key")),
        "config_file": "flowforge.config.json",
        "key_storage": "data/settings.json (local, gitignored)",
    }
