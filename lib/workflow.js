// @dsh-local/dsh-workflow-studio — workflow data model + pure logic.
// No DSH services here: importable and unit-testable. DSH wiring lives in index.js.

export const WORKFLOW_DIR = ".dsh-workflow";

/** Edge intent kinds — semantic categories for what an edge "injects". */
export const EDGE_KINDS = [
	"research-focus",   // 调研关注点（from 开始/计划 → to 调研）
	"source",           // 数据/资料来源
	"context",          // 参考上下文
	"summary-input",    // 总结的输入
	"file-ref",         // 文件引用注入
	"prompt-inject",    // 注入到目标节点 Agent 的 prompt
	"artifact",         // 上游产出物
	"review-gate",      // 评审门
	"rework-target",    // 返工目标（loop 返回箭头）
	"custom"            // 自定义
];

export const NODE_KINDS = ["start", "research", "summary", "plan", "action", "review", "dimension"];
export const ACTION_MODES = ["normal", "ptc", "loop"];

const EMPTY = () => ({
	id: "start-1",
	name: "未命名工作流",
	nodes: [{ id: "start-1", kind: "start", title: "开始", pos: { x: 40, y: 120 } }],
	edges: [],
	plan: "",
	reviewCriteria: [],
	status: "draft"
});

/** Normalize a possibly-undefined workflow to a valid object. */
export function normalizeWorkflow(w) {
	const base = EMPTY();
	if (!w || typeof w !== "object") return base;
	const nodes = Array.isArray(w.nodes)
		? w.nodes.map((n) => (n && typeof n === "object" && typeof n.id === "string" ? {
			id: n.id,
			kind: typeof n.kind === "string" && NODE_KINDS.includes(n.kind) ? n.kind : "plan",
			title: typeof n.title === "string" ? n.title : n.id,
			pos: n.pos && typeof n.pos.x === "number" && typeof n.pos.y === "number" ? n.pos : { x: 60, y: 120 }
		} : null)).filter(Boolean)
		: base.nodes;
	const nodeIds = new Set(nodes.map((n) => n.id));
	const edges = Array.isArray(w.edges)
		? w.edges.filter((e) => e && typeof e === "object" && typeof e.source === "string" && typeof e.target === "string" && e.source !== e.target && nodeIds.has(e.source) && nodeIds.has(e.target))
		: base.edges;
	return {
		id: typeof w.id === "string" ? w.id : base.id,
		name: typeof w.name === "string" ? w.name : base.name,
		nodes,
		edges,
		plan: typeof w.plan === "string" ? w.plan : "",
		reviewCriteria: Array.isArray(w.reviewCriteria) ? w.reviewCriteria : [],
		status: ["draft", "running", "awaiting-review", "done"].includes(w.status) ? w.status : "draft"
	};
}

/** Deterministic candidate intents for an edge, given from/to node kinds & context.
 *  Design-time "edge carries meaning" generator. A real LLM pass can supersede these. */
export function edgeIntentCandidates(fromNode, toNode, ctx = {}) {
	const fk = fromNode?.kind ?? "";
	const tk = toNode?.kind ?? "";
	const out = [];
	const push = (kind, label, detail) => out.push({ kind, label, detail });

	if (fk === "start") {
		if (tk === "research") push("research-focus", "调研什么", "根据目标推导本次调研的关注点与范围");
		if (tk === "plan") push("context", "计划目标", "将整体目标注入计划节点作为规划依据");
		if (tk === "action") push("prompt-inject", "执行目标", "将目标注入 Action 节点作为执行指令");
	}
	if (fk === "research") {
		if (tk === "summary") push("summary-input", "总结调研结果", "汇总全部调研产出生成分析");
		if (tk === "summary") push("summary-input", "选择性调研结果", "按相关性筛选后总结");
		if (tk === "plan") push("source", "调研资料", "将调研结论作为计划的事实依据");
	}
	if (fk === "plan") {
		if (tk === "action") push("prompt-inject", "计划注入执行", "将计划内容注入 Action 节点作为执行依据");
		if (tk === "plan") push("context", "子计划分解", "承接上游计划做进一步分解");
	}
	if (fk === "action") {
		if (tk === "review") push("review-gate", "产出送审", "将 Action 产出交给 Review 审核");
		if (tk === "summary") push("artifact", "产出汇总", "将执行产出纳入总结");
	}
	if (fk === "review") {
		if (tk === "action") push("rework-target", "返工重做", "Loop：从该 Action 节点重新执行");
		if (tk === "review") push("context", "维度补审", "补充另一个审核维度");
	}
	if (fk === "summary") {
		if (tk === "action") push("artifact", "总结注入执行", "将分析结果注入下一步执行");
		if (tk === "plan") push("context", "结论回填计划", "将结论写回计划层");
	}

	// If a file/context detail is provided, incorporate it.
	if (ctx.plan && out.length === 0) push("custom", "依据目标", `依据计划：${String(ctx.plan).slice(0, 40)}`);
	out.push({ kind: "custom", label: "其他", detail: "自定义该边的目的/注入内容" });
	return out;
}

/** Whether an edge between two node kinds is semantically allowed (connection charter).
 *  Whitelist mirrors the candidate branches in edgeIntentCandidates, so every allowed
 *  edge has at least one meaningful intent (plus "custom"). */
export function edgeAllowed(fromKind, toKind) {
	const allowed = new Set([
		"start->research", "start->plan", "start->action", "start->summary",
		"research->summary", "research->plan",
		"plan->action", "plan->plan",
		"action->review", "action->summary",
		"review->action", "review->review",
		"summary->action", "summary->plan",
		// permissive extras that still carry a custom intent
		"research->action", "research->review",
		"plan->research", "plan->review", "plan->summary",
		"action->plan", "action->research", "action->action",
		"review->plan", "review->summary",
		"summary->review", "summary->summary", "summary->research",
		"research->research"
	]);
	return allowed.has(`${fromKind}->${toKind}`);
}

/** Topologically order node ids by directed edges; falls back to insertion order on cycles. */
export function topoSort(nodes, edges) {
	const ids = nodes.map((n) => n.id);
	const indeg = new Map(ids.map((id) => [id, 0]));
	const adj = new Map(ids.map((id) => [id, []]));
	for (const e of edges || []) {
		if (!indeg.has(e.source) || !indeg.has(e.target)) continue;
		adj.get(e.source).push(e.target);
		indeg.set(e.target, indeg.get(e.target) + 1);
	}
	const queue = ids.filter((id) => indeg.get(id) === 0);
	const out = [];
	while (queue.length) {
		const cur = queue.shift();
		out.push(cur);
		for (const next of adj.get(cur) || []) {
			indeg.set(next, indeg.get(next) - 1);
			if (indeg.get(next) === 0) queue.push(next);
		}
	}
	// cycle safety: append any leftover nodes not reached (indeg > 0) in insertion order
	if (out.length < ids.length) {
		for (const id of ids) if (!out.includes(id)) out.push(id);
	}
	return out;
}

/** Assign a default EdgeKind label given a kind. */
export function edgeKindLabel(kind) {
	const m = {
		"research-focus": "调研关注点", "source": "资料来源", "context": "上下文",
		"summary-input": "总结输入", "file-ref": "文件引用", "prompt-inject": "指令注入",
		"artifact": "产出物", "review-gate": "评审门", "rework-target": "返工", "custom": "自定义"
	};
	return m[kind] ?? kind;
}

/** Aggregate review findings: cluster identical/varied dimensions into a deduped checklist. */
export function dedupeReview(reviews) {
	if (!Array.isArray(reviews)) return [];
	const seen = new Set();
	const out = [];
	for (const r of reviews) {
		const key = (r?.dimension ?? "") + "|" + (r?.issue ?? "").trim().toLowerCase();
		if (!key || seen.has(key)) continue;
		seen.add(key);
		out.push({ dimension: r?.dimension ?? "通用", issue: r?.issue ?? "", pass: !!r?.pass });
	}
	return out;
}

/** Transitive downstream node ids reachable from `startId` via directed edges. */
export function downstream(nodeId, edges) {
	const adj = new Map();
	for (const e of edges || []) {
		if (!adj.has(e.source)) adj.set(e.source, []);
		adj.get(e.source).push(e.target);
	}
	const seen = new Set();
	const stack = [nodeId];
	while (stack.length) {
		const cur = stack.pop();
		for (const next of adj.get(cur) || []) {
			if (seen.has(next)) continue;
			seen.add(next);
			stack.push(next);
		}
	}
	seen.delete(nodeId);
	return [...seen];
}

/**
 * Rollback a node's runtime to a target history index and cascade-reset all
 * downstream nodes (their inputs are stale → blank/pending).
 * `runtimes`: map nodeId → { history, pointer }.
 * Returns a new runtimes map (immutable).
 */
export function rollbackCascade(nodes, edges, runtimes, nodeId, toIndex) {
	const next = { ...runtimes };
	const rt = next[nodeId];
	if (!rt) return next;
	const safe = Math.max(0, Math.min(toIndex, (rt.history?.length || 1) - 1));
	next[nodeId] = { history: rt.history || [], pointer: safe };
	for (const id of downstream(nodeId, edges)) {
		next[id] = { history: [], pointer: 0 }; // blank/pending
	}
	return next;
}

/** Compute the next runId from an existing runtimes map. */
export function nextRunId(runtimes) {
	let max = 0;
	for (const rt of Object.values(runtimes || {})) {
		for (const s of rt?.history || []) if (s?.runId > max) max = s.runId;
	}
	return max + 1;
}

/** Heuristic one-line summary of a node's result (prototype; real DSH subagent replaces it). */
export function summarizeNode(node, plan) {
	const kind = node?.kind || "";
	const label = node?.title || kind;
	const base = `「${label}」已完成`;
	switch (kind) {
		case "research": return `${base}：围绕目标输出 ${plan ? "调研要点" : "相关资料"} 与事实清单。`;
		case "summary": return `${base}：汇总上游产出，形成结构化分析。`;
		case "plan": return `${base}：产出可分步执行的计划与角色分工。`;
		case "action": return `${base}：执行并产出可用结果 / 文件。`;
		case "review": return `${base}：完成审核，结果已记录。`;
		default: return `${base}。`;
	}
}

export { normalizeWorkflow as default };
