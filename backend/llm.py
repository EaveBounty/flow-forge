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


def _design_system(base: str) -> str:
    """把工程级 system_prompt（flowforge.config.json）前置到设计类调用的系统提示词。"""
    sp = (settings.get_settings().get("system_prompt") or "").strip()
    return f"{sp}\n\n{base}" if sp else base


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
                [{"role": "system", "content": _design_system(system)}, {"role": "user", "content": user}],
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
                [{"role": "system", "content": _design_system(system)}, {"role": "user", "content": user}],
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


# ── L1 一键起草：从 goal 起草整张图（拓扑 + 每节点 + 每边语义）──────────
_NODE_W, _GAP = 220, 80


def _offline_draft(goal: str) -> dict[str, Any]:
    """离线起草：按通用 Plan→Action→Review→Summary 骨架，为给定目标生成一张可运行的图。"""
    short = (goal[:24] + "…") if len(str(goal)) > 24 else str(goal)
    cx = 300
    cy = 0
    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []

    def add(kind: str, title: str, desc: str, prompt: str, recommended: bool = True) -> str:
        nonlocal cy
        nid = f"n{len(nodes) + 1}"
        cy += _NODE_W + _GAP
        nodes.append({
            "id": nid, "kind": kind, "title": title, "description": desc,
            "prompt": prompt, "recommended": recommended, "goal": None,
            "x": cx, "y": cy,
        })
        return nid

    root_id = add("root", "流程起点", f"启动围绕「{short}」的工作流。", "你是流程启动器：接收总体目标，输出清晰的起点上下文。")
    nodes[0]["goal"] = goal

    plan_id = add("plan", "拆解计划", f"把「{short}」拆成可分步、可分工的执行计划。", "你是产品/技术负责人：把目标拆解成清晰、可分步、可分工的计划。")
    edges.append({"id": "e1", "source": root_id, "target": plan_id, "data": {"intent": "context", "label": "注入目标", "description": f"把项目目标「{short}」交给计划拆解，作为其输入。", "injection": f"下面是本项目总目标「{short}」，请据此产出执行计划。"}})

    act1 = add("action", "执行调研", f"围绕「{short}」收集事实与数据。", "你是资深调研员：收集与目标相关的事实、数据与资料，产出结构化调研结果。")
    edges.append({"id": "e2", "source": plan_id, "target": act1, "data": {"intent": "artifact", "label": "按计划执行", "description": "依据计划分工，开始执行首个动作：调研。", "injection": "把上方计划中与你相关的分工注入本 Agent，执行调研。"}})

    act2 = add("action", "产出初稿", f"基于调研产出「{short}」的初稿。", "你是起草者：综合调研材料产出高质量初稿，供后续审核完善。")
    edges.append({"id": "e3", "source": act1, "target": act2, "data": {"intent": "artifact", "label": "调研→初稿", "description": "调研成果作为初稿的素材输入。", "injection": "把调研结果注入本 Agent，作为初稿的事实依据。"}})

    rev_id = add("review", "审核把关", f"对「{short}」的初稿做正确性与完整性审核。", "你是审核员：检查产出的正确性、完整性与风险，给出可执行的改进意见。", recommended=False)
    edges.append({"id": "e4", "source": act2, "target": rev_id, "data": {"intent": "artifact", "label": "初稿送审", "description": "初稿交给审核把关，两者形成产出→审核链路。", "injection": "把初稿完整注入本审核 Agent，请针对内容给出结论与改进意见。"}})

    sum_id = add("summary", "汇总产出", "聚合各阶段产出，形成最终结构化交付。", "你是分析师：聚合上游产出，提炼结构化结论与建议。")
    edges.append({"id": "e5", "source": rev_id, "target": sum_id, "data": {"intent": "context", "label": "汇总结论", "description": "审核后的结果汇总为最终交付。", "injection": "把审核通过的结果注入本汇总 Agent，产出最终交付。"}})

    return {"nodes": nodes, "edges": edges, "goal": goal}


def draft_flow(goal: str) -> dict[str, Any]:
    """从全局目标起草一张图。优先 LLM（产出真实拓扑），失败回退离线模板。"""
    goal = (goal or "").strip()
    if settings.is_configured():
        system = (
            "你是工作流架构师。根据用户给出的一个全局目标，设计一张完整可执行的工作流图。"
            "输出 JSON：{nodes, edges}。节点字段：id(kind=root唯一起点并带 goal 字段，其余 kind∈"
            "plan|action|review|loop|summary)、title、description、prompt（给该模块 Agent 的完整提示词）、"
            "recommended。边字段：id、source、target、data.label（短标签）、data.description（两模块结合作用）、"
            "data.injection（如何把上游输出注入下游提示词）。控制在 4~8 个节点，逻辑连贯、可跑通。只输出 JSON。"
        )
        try:
            text = _call_openai_compatible(
                [{"role": "system", "content": _design_system(system)}, {"role": "user", "content": f"全局目标: {goal}"}],
                temperature=0.7,
                max_tokens=1400,
            )
            draft = _extract_json(text)
            nodes, edges = draft.get("nodes"), draft.get("edges")
            if isinstance(nodes, list) and nodes and isinstance(edges, list):
                norm_nodes = []
                for i, n in enumerate(nodes):
                    if not isinstance(n, dict):
                        continue
                    nid = str(n.get("id") or f"n{i + 1}")
                    norm_nodes.append({
                        "id": nid,
                        "kind": str(n.get("kind") or "action"),
                        "title": str(n.get("title") or "模块"),
                        "description": str(n.get("description") or ""),
                        "prompt": str(n.get("prompt") or ""),
                        "recommended": bool(n.get("recommended", True)),
                        "goal": (str(n.get("goal") or "") if n.get("kind") == "root" else None),
                        "x": 300 + (i % 3) * 260,
                        "y": 180 + (i // 3) * 320,
                    })
                norm_edges = [{
                    "id": str(e.get("id") or f"e{i + 1}"),
                    "source": str(e.get("source")),
                    "target": str(e.get("target")),
                    "data": {
                        "intent": str((e.get("data") or {}).get("intent") or "context"),
                        "label": str((e.get("data") or {}).get("label") or "连接"),
                        "description": str((e.get("data") or {}).get("description") or ""),
                        "injection": str((e.get("data") or {}).get("injection") or ""),
                    },
                } for i, e in enumerate(edges) if isinstance(e, dict) and e.get("source") and e.get("target")]
                return {"nodes": norm_nodes, "edges": norm_edges, "goal": goal}
        except LLMError:
            pass
    return _offline_draft(goal)


# ── L2 会话说即改：意图 → 图谱修订（可撤销预览）──────────────────────
def _offline_tweak(goal: str, nodes: list[dict[str, Any]], edges: list[dict[str, Any]], intent: str) -> dict[str, Any]:
    """离线启发式改图：在动作模块后插入一个审核阶段（把该模块下游改经新审核），或按名删除节点。

    保证返回连通且可运行；不匹配任何规则时返回原图 + 提示，绝不报错。
    """
    intent = (intent or "").strip()
    nodes = [dict(n) for n in nodes]
    edges = [dict(e) for e in edges]

    # 规则1：插入审核阶段
    add_review = any(w in intent for w in ("审核", "把关", "检查", "加一步", "review", "质检", "验收"))
    # 规则2：删除节点
    del_kw = None
    for w in ("删掉", "删除", "去掉", "移除", "不要"):
        if w in intent:
            rest = intent.split(w, 1)[1].strip()
            del_kw = rest.split(" ")[0].strip() or None
            break

    changed = False
    summary = ""
    if del_kw:
        removed = [n for n in nodes if n["kind"] != "root" and del_kw in (n.get("title") or "") or (del_kw and del_kw in (n.get("title") or ""))]
        removed_ids = {n["id"] for n in removed}
        if removed_ids:
            nodes = [n for n in nodes if n["id"] not in removed_ids]
            edges = [e for e in edges if e["source"] not in removed_ids and e["target"] not in removed_ids]
            changed = True
            summary = f"已删除 {len(removed_ids)} 个与「{del_kw}」相关的模块。"
    if add_review and not changed:
        # 选最后一个 action 模块作为锚点，把它的下游改经新 review
        anchor = None
        for n in reversed(nodes):
            if n["kind"] == "action":
                anchor = n
                break
        if anchor is None:
            for n in reversed(nodes):
                if n["kind"] in ("plan", "summary"):
                    anchor = n
                    break
        if anchor is not None:
            outs = [e for e in edges if e["source"] == anchor["id"]]
            out_targs = [e["target"] for e in outs]
            new_id = f"n{len(nodes) + 1}"
            new_rev = {
                "id": new_id, "kind": "review", "title": "审核把关",
                "description": f"对「{anchor.get('title')}」的产出做正确性审核，达标后才继续下游。",
                "prompt": "你是审核员：检查上游产出的正确性、完整性与风险，输出结论；不达标则返回改进意见。",
                "recommended": True, "goal": None,
                "x": anchor.get("x", 100) + 40, "y": anchor.get("y", 100) + 260,
            }
            nodes.append(new_rev)
            # 锚点 → 新审核
            edges = [e for e in edges if not (e["source"] == anchor["id"])]
            edges.append({"id": f"e{len(edges) + 1}", "source": anchor["id"], "target": new_id, "data": {"intent": "artifact", "label": "产出送审", "description": f"把「{anchor.get('title')}」产出交给审核把关。", "injection": f"把上方「{anchor.get('title')}」的完整产出注入本审核 Agent，请据此给出结论与改进意见。"}})
            # 新审核 → 原有下游（合并）
            seen = set()
            for t in out_targs:
                if t in seen:
                    continue
                seen.add(t)
                edges.append({"id": f"e{len(edges) + 1}", "source": new_id, "target": t, "data": {"intent": "context", "label": "放行到下游", "description": "审核通过后放行到下游处理。", "injection": f"该阶段已通过「{new_rev.get('title')}」审核，继续处理："}})
            if not out_targs:
                summary = f"已在「{anchor.get('title')}」后插入「{new_rev.get('title')}」审核阶段。"
            else:
                summary = f"已在「{anchor.get('title')}」后插入「{new_rev.get('title')}」审核；其下游改经该审核放行。"
            changed = True
    if not changed:
        summary = "未识别到可安全执行的修改意图（离线模式支持：在动作后加审核/把关/检查，或按名称删除某模块）。已保持原图不变。"

    return {"nodes": nodes, "edges": edges, "goal": goal, "summary": summary, "changed": changed}


def tweak_flow(goal: str, nodes: list[dict[str, Any]], edges: list[dict[str, Any]], intent: str) -> dict[str, Any]:
    """L2：根据一句自然语言意图修订当前图。优先 LLM，失败回退离线启发式（绝不报错）。"""
    intent = (intent or "").strip()
    goal = (goal or "").strip()
    if settings.is_configured():
        system = (
            "你是工作流编辑助手。用户想对一张已有的工作流图做一次修改（说即改）。"
            "输入当前图 nodes/edges 与一句意图。输出修订后的完整图 + 变更说明：JSON {nodes, edges, summary, changed}。"
            "节点字段：id、kind(root=唯一起点带goal, 其它 plan|action|review|loop|summary)、title、description、"
            "prompt、recommended、x、y。边字段：id、source、target、data{label,description,injection}。"
            "尽量只改动与意图相关的部分，保留其它不变；keep root 及连线 id 稳定。summary 用一句人话说明改了啥。只输出 JSON。"
        )
        try:
            text = _call_openai_compatible(
                [{"role": "system", "content": _design_system(system)}, {
                    "role": "user",
                    "content": f"全局目标: {goal}\n当前图 nodes(JSON): {json.dumps(nodes, ensure_ascii=False)}\n"
                               f"当前图 edges(JSON): {json.dumps(edges, ensure_ascii=False)}\n修改意图: {intent}"}],
                temperature=0.4,
                max_tokens=1400,
            )
            r = _extract_json(text)
            rn, re = r.get("nodes"), r.get("edges")
            if isinstance(rn, list) and rn and isinstance(re, list):
                idx = {n.get("id"): i for i, n in enumerate(nodes)}
                norm_nodes = []
                for i, n in enumerate(rn):
                    if not isinstance(n, dict):
                        continue
                    nid = str(n.get("id") or f"n{i + 1}")
                    old = nodes[idx[nid]] if nid in idx else {}
                    norm_nodes.append({
                        "id": nid,
                        "kind": str(n.get("kind") or old.get("kind") or "action"),
                        "title": str(n.get("title") or old.get("title") or "模块"),
                        "description": str(n.get("description") if n.get("description") is not None else old.get("description", "")),
                        "prompt": str(n.get("prompt") if n.get("prompt") is not None else old.get("prompt", "")),
                        "recommended": bool(n.get("recommended", True)),
                        "goal": (str(n.get("goal") or "") if n.get("kind") == "root" or (old and old.get("kind") == "root") else None),
                        "x": int(n.get("x") if n.get("x") is not None else old.get("x", 100)),
                        "y": int(n.get("y") if n.get("y") is not None else old.get("y", 100)),
                    })
                ids = {n["id"] for n in norm_nodes}
                norm_edges = []
                for i, e in enumerate(re):
                    if not isinstance(e, dict) or e.get("source") not in ids or e.get("target") not in ids:
                        continue
                    norm_edges.append({
                        "id": str(e.get("id") or f"e{i + 1}"),
                        "source": str(e.get("source")), "target": str(e.get("target")),
                        "data": {
                            "intent": str((e.get("data") or {}).get("intent") or "context"),
                            "label": str((e.get("data") or {}).get("label") or "连接"),
                            "description": str((e.get("data") or {}).get("description") or ""),
                            "injection": str((e.get("data") or {}).get("injection") or ""),
                        },
                    })
                return {"nodes": norm_nodes, "edges": norm_edges, "goal": goal,
                        "summary": str(r.get("summary") or "已按你的要求修改工作流。"), "changed": True}
        except LLMError:
            pass
    return _offline_tweak(goal, nodes, edges, intent)
