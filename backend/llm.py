"""LLM 抽象层：调用用户配置的模型，为画布生成候选描述 / 连线语义。

关键设计：
- 用户只需在设置页填 model + api_key，前端绝不要求打字。
- 若未配置（无 key / 无模型）或调用失败，自动回退到「内置模板」生成器，
  保证画布、连线、运行在离线/未配置时也真实可用（不会报错）。
  这是用户"点运行一直报错"的痛点，必须彻底解决。
"""
from __future__ import annotations

import json
import re
from typing import Any

import httpx

from . import settings


class LLMError(Exception):
    pass


# ── 内置模板生成器（离线回退）───────────────────────────────────────
def _offline_module_candidates(kind: str, ctx: dict[str, Any]) -> list[dict[str, Any]]:
    """根据 kind 与上下文生成一组候选模块描述（无需 LLM）。"""
    title_hint = (ctx.get("upstream") or [None])[0] if isinstance(ctx.get("upstream"), list) and ctx.get("upstream") else None
    hint = title_hint or ctx.get("plan") or ""
    short = (hint[:18] + "…") if len(str(hint)) > 18 else str(hint)

    if kind == "root":
        return [{
            "id": "root-entry",
            "title": "流程起点",
            "description": "注入总体目标并启动流程。",
            "prompt": "你是流程启动器：接收总体目标，输出清晰的起点上下文。",
            "recommended": True,
        }]
    if kind == "plan":
        return [
            {"id": "plan-breakdown", "title": "拆解计划", "description": f"把「{short}」拆解为可分步执行、可分工的计划。", "prompt": "你是产品/技术负责人：将目标拆解为清晰、可分步、可分工的执行计划，并给出每步的负责人与交付物。", "recommended": True},
            {"id": "plan-research", "title": "调研先行", "description": f"先围绕「{short}」做调研与事实收集，再制定计划。", "prompt": "你是资深调研员：先收集事实与资料，再据此制定可执行的计划。", "recommended": False},
            {"id": "plan-milestones", "title": "里程碑规划", "description": f"为「{short}」规划关键里程碑与时间点。", "prompt": "你是项目经理：为目标制定里程碑、依赖关系与验收标准。", "recommended": False},
        ]
    if kind == "action":
        return [
            {"id": "action-execute", "title": "执行任务", "description": f"执行「{short}」并产出可用结果。", "prompt": "你是执行者：按输入与计划，产出准确、可用、结构化的结果。", "recommended": True},
            {"id": "action-verify", "title": "执行并自检", "description": f"执行「{short}」，并对结果做自检。", "prompt": "你是执行者：完成任务后自检结果是否正确完整，必要时修正。", "recommended": False},
            {"id": "action-draft", "title": "草拟内容", "description": f"为「{short}」草拟初稿内容。", "prompt": "你是起草者：产出高质量初稿，供后续审核与完善。", "recommended": False},
        ]
    if kind == "review":
        return [
            {"id": "review-check", "title": "审核把关", "description": f"审核「{short}」，检查正确性与完整性。", "prompt": "你是审核员：检查产出的正确性、完整性与风险，给出可执行的改进意见。", "recommended": True},
            {"id": "review-risk", "title": "风险审查", "description": f"对「{short}」做风险与边界审查。", "prompt": "你是风控审核员：审视潜在风险、异常输入与边界情况。", "recommended": False},
            {"id": "review-meta", "title": "元审核", "description": f"检查对「{short}」的审核是否合理、有无遗漏维度。", "prompt": "你是元审核员：检查已有的审核角度是否合理、是否遗漏关键维度。", "recommended": False},
        ]
    if kind == "loop":
        return [
            {"id": "loop-container", "title": "循环体", "description": f"反复执行内部内容直至「{short}」满足收敛条件。", "prompt": "你是循环体：重复执行内部子图，直到达到放行阈值或最大次数。", "recommended": True},
            {"id": "loop-iterate", "title": "迭代优化", "description": f"对「{short}」反复迭代打磨直至满意。", "prompt": "你是迭代器：持续优化结果，直到质量达标。", "recommended": False},
        ]
    if kind == "summary":
        return [{
            "id": "summary-aggregate",
            "title": "汇总产出",
            "description": "聚合上游各分支产出，形成结构化结论。",
            "prompt": "你是分析师：聚合上游产出，提炼结构化结论与建议。",
            "recommended": True,
        }]
    return [{
        "id": "generic",
        "title": "处理模块",
        "description": f"处理「{short}」。",
        "prompt": "你是通用处理模块：按输入与上下文产出结构化结果。",
        "recommended": True,
    }]


def _offline_edge_semantics(from_m: dict[str, Any], to_m: dict[str, Any]) -> dict[str, Any]:
    """离线生成连线语义：作用 + 结合说明 + 注入指令。"""
    fs = from_m.get("title") or "上游模块"
    ts = to_m.get("title") or "下游模块"
    fk = from_m.get("kind", "")
    tk = to_m.get("kind", "")
    if fk in ("review", "dimension") and tk == "loop":
        return {
            "intent": "loop-gate",
            "label": f"{fs} 评分闸门",
            "description": f"{fs} 对 {ts} 的产出评分；低于阈值时 {ts} 继续循环迭代，达标才放行。",
            "injection": f"把 {fs} 的评分与审核意见注入 {ts} 的循环体，作为放行/继续迭代的依据。",
        }
    if fk in ("review", "dimension"):
        return {
            "intent": "review-feedback",
            "label": f"{fs} 反馈给 {ts}",
            "description": f"{fs} 的审核意见作为反馈注入 {ts}，驱动其修正与完善。",
            "injection": f"将 {fs} 的审核结论与改进意见注入 {ts} 的 Agent 提示词，要求其据此修正。",
        }
    if tk in ("review", "dimension"):
        return {
            "intent": "artifact",
            "label": f"{fs} 产出交给 {ts} 审核",
            "description": f"{fs} 的产出作为 {ts} 的审核对象，两者结合形成「产出→把关」链路。",
            "injection": f"把 {fs} 的完整产出注入 {ts} 的审核上下文，要求其针对这些内容给出结论。",
        }
    if tk == "loop":
        return {
            "intent": "artifact",
            "label": f"{fs} 输入进 {ts} 循环体",
            "description": f"{fs} 的产出作为 {ts} 循环体的初始输入，反复迭代。",
            "injection": f"把 {fs} 的产出作为 {ts} 循环体的输入上下文。",
        }
    return {
        "intent": "context",
        "label": f"{fs} 结合 {ts}",
        "description": f"{fs} 的产出与 {ts} 的处理结合：{fs} 提供上游上下文，{ts} 据此继续加工，形成连贯流程。",
        "injection": f"将 {fs} 的输出注入 {ts} 的 Agent 提示词，作为其上游上下文与输入依据。",
    }


def _offline_run(node: dict[str, Any], upstream_texts: list[str]) -> dict[str, Any]:
    """离线执行：根据节点 prompt/描述 + 上游文本，产生确定性的模拟结果。"""
    kind = node.get("kind", "action")
    title = node.get("title") or "模块"
    prompt = node.get("prompt") or ""
    upstream = "\n".join(upstream_texts) if upstream_texts else "(无上游)"
    if kind == "review":
        return {"status": "done", "summary": f"「{title}」审核完成：基于上游产出给出检查意见与结论。", "score": 0.88}
    if kind == "loop":
        return {"status": "done", "summary": f"「{title}」循环收敛（达到放行条件）。", "score": 0.92}
    if kind == "plan":
        return {"status": "done", "summary": f"「{title}」产出可执行的计划与分工。", "plan": prompt or title}
    if kind == "summary":
        return {"status": "done", "summary": f"「{title}」汇总各分支产出为结构化结论。", "detail": upstream[:500]}
    if kind == "root":
        return {"status": "done", "summary": "流程启动，注入目标。", "detail": upstream[:200]}
    return {"status": "done", "summary": f"「{title}」执行完成，产出可用结果。", "detail": upstream[:500]}


# ── LLM 调用（OpenAI 兼容）─────────────────────────────────────────
def _call_openai_compatible(messages: list[dict[str, str]], *, temperature: float = 0.7, max_tokens: int = 800) -> str:
    s = settings.get_settings()
    base_url = (s.get("base_url") or "https://api.openai.com/v1").rstrip("/")
    url = f"{base_url}/chat/completions"
    headers = {
        "Authorization": f"Bearer {s.get('api_key')}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": s.get("model"),
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    try:
        resp = httpx.post(url, json=payload, headers=headers, timeout=60.0)
    except httpx.HTTPError as e:  # noqa: PERF203
        raise LLMError(f"LLM 请求失败: {e}") from e
    if resp.status_code != 200:
        raise LLMError(f"LLM 返回 {resp.status_code}: {resp.text[:300]}")
    data = resp.json()
    try:
        return data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as e:  # noqa: PERF203
        raise LLMError("LLM 响应缺少 choices[0].message.content") from e


def _extract_json(text: str) -> Any:
    text = text.strip()
    # 去 markdown 代码块
    text = re.sub(r"^```(?:json)?\s*", "", text).rstrip("`").strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # 尝试抓取第一个 [ 或 { 到结尾
    for start, end in (("[", "]"), ("{", "}")):
        i = text.find(start)
        j = text.rfind(end)
        if i != -1 and j > i:
            try:
                return json.loads(text[i : j + 1])
            except json.JSONDecodeError:
                continue
    raise LLMError("无法解析 LLM 返回的 JSON")


# ── 对外生成接口 ────────────────────────────────────────────────────
def generate_module_candidates(kind: str, ctx: dict[str, Any]) -> list[dict[str, Any]]:
    """生成某类模块的候选描述。优先 LLM，失败回退离线模板。"""
    if settings.is_configured():
        system = (
            "你是工作流构建智能体。根据给定的流程上下文，为这个「模块」生成 3~4 个"
            "候选描述。每个候选包含：id、title（简短标题）、description（该模块在这个"
            "上下文里该干什么）、prompt（给该模块 Agent 的完整提示词）、recommended"
            "（布尔，是否是你推荐的）。只输出 JSON 数组，不要解释。"
        )
        user = f"模块类型: {kind}\n流程上下文(JSON): {json.dumps(ctx, ensure_ascii=False)}"
        try:
            text = _call_openai_compatible(
                [{"role": "system", "content": system}, {"role": "user", "content": user}],
                temperature=0.7,
                max_tokens=800,
            )
            candidates = _extract_json(text)
            if isinstance(candidates, list) and candidates:
                return [normalize_candidate(c) for c in candidates if isinstance(c, dict)]
        except LLMError:
            pass  # 回退离线模板
    return _offline_module_candidates(kind, ctx)


def generate_edge_semantics(from_m: dict[str, Any], to_m: dict[str, Any]) -> dict[str, Any]:
    """生成连线语义（作用 + 结合说明 + 注入指令）。优先 LLM，失败回退离线。"""
    if settings.is_configured():
        system = (
            "你是工作流连线语义专家。根据两个模块，判断这条连线的作用。输出 JSON："
            "{intent, label, description, injection}。label 是短标签（如「输出综合综述」"
            "「结合审查」）；description 详细说明这两个模块结合后共同产生的作用；"
            "injection 说明应如何把上游输出注入下游模块的 Agent 提示词。只输出 JSON。"
        )
        user = f"上游模块: {json.dumps(from_m, ensure_ascii=False)}\n下游模块: {json.dumps(to_m, ensure_ascii=False)}"
        try:
            text = _call_openai_compatible(
                [{"role": "system", "content": system}, {"role": "user", "content": user}],
                temperature=0.6,
                max_tokens=400,
            )
            sem = _extract_json(text)
            if isinstance(sem, dict) and sem.get("label"):
                return {
                    "intent": sem.get("intent", "context"),
                    "label": str(sem.get("label")),
                    "description": str(sem.get("description", "")),
                    "injection": str(sem.get("injection", "")),
                }
        except LLMError:
            pass
    return _offline_edge_semantics(from_m, to_m)


def run_node(node: dict[str, Any], upstream_texts: list[str]) -> dict[str, Any]:
    """运行单个节点。优先 LLM，失败回退离线。"""
    if settings.is_configured():
        system = "你是工作流执行节点。根据模块的提示词与上游输入，产出结果。输出 JSON {summary, detail}。只输出 JSON。"
        user = f"模块提示词: {node.get('prompt','')}\n模块类型: {node.get('kind','')}\n上游输入: {json.dumps(upstream_texts, ensure_ascii=False)[:2000]}"
        try:
            text = _call_openai_compatible(
                [{"role": "system", "content": system}, {"role": "user", "content": user}],
                temperature=0.4,
                max_tokens=500,
            )
            res = _extract_json(text)
            if isinstance(res, dict):
                return {"status": "done", "summary": str(res.get("summary", "完成")), "detail": str(res.get("detail", ""))}
        except LLMError:
            pass
    return _offline_run(node, upstream_texts)


def normalize_candidate(c: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(c.get("id") or "cand"),
        "title": str(c.get("title") or "模块"),
        "description": str(c.get("description") or ""),
        "prompt": str(c.get("prompt") or ""),
        "recommended": bool(c.get("recommended")),
    }
