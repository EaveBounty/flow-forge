// @dsh-local/dsh-workflow-studio — semantic auto-naming & edge-purpose inference.
// Pure functions (no IO, no React). Drives the "自主性/智能性" requirement: when the
// user drops a node or connects two nodes, we automatically decide what the node is for
// and what data/purpose an edge carries, instead of leaving generic labels.
//
// Two category models coexist:
//   • VISIBLE_MENU = the 4 left-menu buttons the user mandated: plan / action / review / loop.
//   • NODE_KINDS   = the full internal data model (root + the 4 + legacy summary/dimension),
//     kept for backward compatibility with persisted workflows and the native compiler.

export const VISIBLE_MENU = ["plan", "action", "review", "loop"];
export const NODE_KINDS = ["root", "plan", "action", "review", "summary", "dimension", "loop"];

// Per-category default agent ids (the "defaults" the user described at the very start).
export const CATEGORY_AGENTS = {
	plan: ["agent.planner", "agent.research", "agent.analyst"],
	action: ["agent.executor"],
	review: ["agent.reviewer"],
	loop: ["agent.executor"]
};

// Short human role for a category (used to build auto names).
const ROLE_OF = {
	root: "root",
	plan: "plan",
	action: "action",
	review: "review",
	loop: "loop",
	summary: "summary",
	dimension: "dimension"
};

// Which side of the graph a node "faces": producers push artifacts; consumers pull.
const KIND_FACET = {
	root: "source", plan: "transit", action: "producer", review: "consumer",
	loop: "producer", summary: "consumer", dimension: "consumer"
};

/**
 * Build a default node title for a category, given the upstream data that will flow in.
 * `hint` is any free text the user already attached (prompt / prior title) — if present we
 * preserve the spirit of it instead of overwriting with a generic title.
 * @returns {{title:string, purpose:string}}
 */
export function autoNodeName(category, opts = {}) {
	const kind = NODE_KINDS.includes(category) ? category : "action";
	const hint = (opts.hint && String(opts.hint).trim()) || "";
	const upstream = Array.isArray(opts.upstream) ? opts.upstream.filter(Boolean) : [];
	const downstream = Array.isArray(opts.downstream) ? opts.downstream.filter(Boolean) : [];
	const hintTitle = hint.length > 18 ? hint.slice(0, 18) + "…" : hint;
	const purpose = buildPurpose(kind, hint, upstream, downstream);

	let title;
	if (hintTitle) {
		title = hintTitle;
	} else if (kind === "root") {
		title = "流程起点";
	} else if (kind === "loop") {
		title = "循环体";
	} else if (kind === "review") {
		title = upstream.length ? `审核「${short(upstream[0])}」` : "审核";
	} else if (kind === "action") {
		title = upstream.length ? `执行「${short(upstream[0])}」` : "执行任务";
	} else if (kind === "plan") {
		title = upstream.length ? `规划「${short(upstream[0])}」` : "规划";
	} else {
		title = kind === "summary" ? "汇总" : kind === "dimension" ? "维度审核" : kind;
	}
	return { title, purpose };
}

function short(s) { const t = String(s || "").trim(); return t.length > 12 ? t.slice(0, 12) + "…" : t; }

/** Compose a human sentence describing what this node does in this position. */
function buildPurpose(kind, hint, upstream, downstream) {
	const from = upstream.length ? `接收「${short(upstream[0])}」` : "启动流程";
	const to = downstream.length ? `交给「${short(downstream[0])}」` : "产出结果";
	switch (kind) {
		case "root": return "流程入口：注入总体目标并启动。";
		case "plan": return `规划：把目标拆解成可分步执行的计划，${from}。`;
		case "action": return `执行：${from}，按计划产出可用结果${downstream.length ? "，" + to : "。"}`;
		case "review": return `审核：对上游产出做检查与反馈，判定是否放行。`;
		case "loop": return `循环：${from}，反复迭代直至满足放行条件。`;
		case "summary": return `汇总：聚合各分支产出，形成结构化结论。`;
		case "dimension": return `维度审核：从单一角度检查上游产出的质量。`;
		default: return "处理节点。";
	}
}

// Edge intent whitelist (mirrors lib/workflow.js edgeAllowed) for semantic inference.
export const EDGE_INTENTS = ["context", "artifact", "prompt-inject", "review-feedback", "loop-gate", "output", "custom"];

/**
 * Infer what an edge means given the source & target kinds (and optional context).
 * Returns {intent, label, detail} — the label is a human sentence the user asked for
 * ("写清楚这边连线的作用"), detail a longer explanation.
 */
export function autoEdgeSemantics(fromKind, toKind, opts = {}) {
	const f = NODE_KINDS.includes(fromKind) ? fromKind : "action";
	const t = NODE_KINDS.includes(toKind) ? toKind : "action";
	const fromTitle = (opts.fromTitle && String(opts.fromTitle).trim()) || "上游";
	const toTitle = (opts.toTitle && String(opts.toTitle).trim()) || "下游";
	const fs = short(fromTitle), ts = short(toTitle);

	// Review → Loop : the review scores the loop and gates its re-iteration.
	if ((f === "review" || f === "dimension") && t === "loop") {
		return { intent: "loop-gate", label: `审核「${ts}」评分闸门`, detail: `「${fs}」对「${ts}」的产出评分；低于放行阈值时循环体再次迭代。` };
	}
	// Review → anything : the review's feedback is handed downstream as a correction signal.
	if (f === "review" || f === "dimension") {
		return { intent: "review-feedback", label: `审核反馈→「${ts}」`, detail: `「${fs}」的检查意见作为反馈注入「${ts}」，驱动修正。` };
	}
	// anything → Review : hand the artifact to be audited.
	if (t === "review" || t === "dimension") {
		return { intent: "artifact", label: `产出→审核「${ts}」`, detail: `「${fs}」的产出交给「${ts}」审核。` };
	}
	// anything → Loop : feed a cycle body.
	if (t === "loop") {
		return { intent: "artifact", label: `输入→循环「${ts}」`, detail: `「${fs}」的产出作为「${ts}」循环体的输入。` };
	}
	// Plan → downstream : hand the plan forward as context.
	if (f === "plan") {
		return { intent: "context", label: `计划→「${ts}」`, detail: `「${fs}」制定的计划作为「${ts}」的执行依据。` };
	}
	// producer → consumer default: pass the artifact.
	return { intent: "artifact", label: `产出→「${ts}」`, detail: `「${fs}」的产出传递给「${ts}」继续处理。` };
}

/**
 * Given a node's category and its connections, propose the best agent + title for it.
 * Pure convenience used by the client when a node is dropped onto the canvas.
 */
export function suggestNodeConfig(category, opts = {}) {
	const kind = NODE_KINDS.includes(category) ? category : "action";
	const defaultAgent = (CATEGORY_AGENTS[kind] && CATEGORY_AGENTS[kind][0]) || (kind === "review" || kind === "dimension" ? "agent.reviewer" : "agent.executor");
	const { title, purpose } = autoNodeName(kind, opts);
	return { agentId: defaultAgent, title, purpose, kind };
}

// Re-export helpers for the host.
export function kindFacet(kind) { return KIND_FACET[kind] || "transit"; }
export function roleOf(kind) { return ROLE_OF[kind] || "action"; }
