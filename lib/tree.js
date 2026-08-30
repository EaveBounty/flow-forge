// @dsh-local/dsh-workflow-studio — tree workflow data model (pure logic, unit-testable).
// Philosophy (user-corrected):
//   1. One pipeline that grows like a tree from a single root — not a linear Plan→Action→Review.
//   2. Created by conversation (AI builds the tree), then edited on canvas.
//   3. Node kinds are flexible; every Action exposes a "Review" interface that can connect anywhere.
//   4. Review landing semantics are guessed by the AI, not hardcoded:
//        (a) Review → a sub-node      = check/feedback on that sub-node's work from some angle
//        (b) Review → a Loop's gate   = return a sufficient score to let the Loop pass, else keep looping
//   5. Node children = preset or user-custom Agents.
//   6. Flow end is per-branch and arbitrary: a branch can end in a file output (file bubble), not a unified report.
//   7. Branches run in parallel.
//
// This module is pure (no DSH services). Compiled to native DSH workflow scripts in compile.js.

export const ROOT_KIND = "root";
export const NODE_KINDS = ["root", "plan", "action", "review", "summary", "dimension", "loop"];
export const ACTION_MODES = ["normal", "ptc", "loop"];

/** Built-in preset agents (id → descriptor). Users can add their own. */
export const PRESET_AGENTS = {
  "agent.research": { id: "agent.research", name: "调研员", role: "research", prompt: "你是资深调研员：第一性原理拆解目标，输出事实清单与资料来源。" },
  "agent.analyst": { id: "agent.analyst", name: "分析师", role: "summary", prompt: "你是分析师：汇总上游产出，提炼结构化结论与风险。" },
  "agent.planner": { id: "agent.planner", name: "产品经理", role: "plan", prompt: "你是产品经理：将目标拆解为可分步执行、可分工的计划。" },
  "agent.executor": { id: "agent.executor", name: "执行者", role: "action", prompt: "你是执行者：按输入产出可用结果与文件。" },
  "agent.reviewer": { id: "agent.reviewer", name: "审核员", role: "review", prompt: "你是多维度审核员：从功能完整性、正确性、风险等角度检查并反馈。" }
};

/** Edge intent kinds — semantic meaning of what an edge injects / routes. */
export const EDGE_KINDS = [
  "context",           // reference context
  "artifact",          // upstream output
  "prompt-inject",     // inject into downstream agent prompt
  "review-feedback",   // a Review node feeding its judgment back to a sub-node
  "loop-gate",         // a Review node gating a Loop (score threshold)
  "output",            // branch output (file)
  "custom"
];

/** A node in the tree. `agentId` references an agent registry entry (preset or custom).
 *  A `loop` node is a LOOP BODY container: its `subGraph` ({nodes, edges}) is a nested
 *  free graph that runs repeatedly until the loop gate passes. */
export function makeNode(id, { kind = "action", title, agentId, prompt = "", files = [], review = [], loop = {}, out = null, subGraph = null } = {}) {
  return {
    id,
    kind: NODE_KINDS.includes(kind) ? kind : "action",
    title: typeof title === "string" && title ? title : (PRESET_AGENTS[agentId]?.name || kind),
    agentId: agentId || defaultAgentFor(kind),
    prompt,
    files: Array.isArray(files) ? files : [],
    review: Array.isArray(review) ? review : [],   // review findings (for review nodes)
    loop: loop || {},                              // { mode, score, threshold, maxAttempts }
    out,                                            // { type:'file'|'text', path?, text? } — per-branch output
    subGraph: subGraph || null                     // for loop nodes: nested graph {nodes, edges}
  };
}

export function defaultAgentFor(kind) {
  const m = { research: "agent.research", summary: "agent.analyst", plan: "agent.planner", action: "agent.executor", review: "agent.reviewer", dimension: "agent.reviewer" };
  return m[kind] || "agent.executor";
}

/** A directed edge; `intent` is the semantic. */
export function makeEdge(id, source, target, intent = "custom", data = {}) {
  return { id, source, target, intent, data: data || {} };
}

/** Normalize an arbitrary workflow object into the tree shape (defensive). */
export function normalizeTree(w) {
  const has = (o) => o && typeof o === "object";
  const nodes = Array.isArray(w?.nodes)
    ? w.nodes.filter(has).map((n) => ({
        id: String(n.id || ""),
        kind: NODE_KINDS.includes(n.kind) ? n.kind : "action",
        title: typeof n.title === "string" ? n.title : String(n.id || "node"),
        agentId: typeof n.agentId === "string" ? n.agentId : defaultAgentFor(n.kind),
        prompt: typeof n.prompt === "string" ? n.prompt : "",
        files: Array.isArray(n.files) ? n.files : [],
        review: Array.isArray(n.review) ? n.review : [],
        loop: has(n.loop) ? n.loop : {},
        out: has(n.out) ? n.out : null,
        subGraph: has(n.subGraph) ? n.subGraph : null,
        pos: has(n.pos) ? n.pos : { x: 60, y: 60 }
      })).filter((n) => n.id)
    : [];
  const ids = new Set(nodes.map((n) => n.id));
  const edges = Array.isArray(w?.edges)
    ? w.edges.filter(has).filter((e) => typeof e.source === "string" && typeof e.target === "string" && e.source !== e.target && ids.has(e.source) && ids.has(e.target)).map((e) => ({
        id: typeof e.id === "string" ? e.id : `e-${e.source}-${e.target}`,
        source: e.source, target: e.target,
        intent: EDGE_KINDS.includes(e.intent) ? e.intent : "custom",
        data: has(e.data) ? e.data : {}
      }))
    : [];
  // agent registry: presets + user customs
  const agents = { ...PRESET_AGENTS };
  if (Array.isArray(w?.agents)) for (const a of w.agents) if (has(a) && typeof a.id === "string") agents[a.id] = { ...a };
  return {
    id: typeof w?.id === "string" ? w.id : "tree-1",
    name: typeof w?.name === "string" ? w.name : "工作流",
    rootId: typeof w?.rootId === "string" && ids.has(w.rootId) ? w.rootId : (nodes[0]?.id || ""),
    nodes, edges, agents,
    plan: typeof w?.plan === "string" ? w.plan : "",
    status: ["draft", "running", "done", "awaiting-review"].includes(w?.status) ? w.status : "draft"
  };
}

/** Children of a node (nodes that have an incoming edge from it). */
export function childrenOf(nodeId, nodes, edges) {
  return edges.filter((e) => e.source === nodeId).map((e) => e.target).filter((t, i, a) => a.indexOf(t) === i);
}

/** Roots of the tree (no incoming edges). Usually one. */
export function roots(nodes, edges) {
  const hasIn = new Set(edges.map((e) => e.target));
  return nodes.filter((n) => !hasIn.has(n.id)).map((n) => n.id);
}

/**
 * Branch grouping for parallel execution: group node ids into stages where
 * nodes whose dependencies (all incoming) are satisfied run in parallel.
 * Returns an array of stages; each stage is an array of node ids to run in parallel.
 * Cycle-tolerant: nodes trapped in a feedback cycle (no zero-indegree frontier left)
 * are appended as their own final stage so the caller still sees every node.
 */
export function parallelStages(nodes, edges) {
  const ids = nodes.map((n) => n.id);
  const indeg = new Map(ids.map((id) => [id, 0]));
  const adj = new Map(ids.map((id) => [id, []]));
  for (const e of edges || []) {
    if (!indeg.has(e.source) || !indeg.has(e.target)) continue;
    adj.get(e.source).push(e.target);
    indeg.set(e.target, indeg.get(e.target) + 1);
  }
  const stages = [];
  let remaining = ids.length;
  const done = new Set();
  while (remaining > 0) {
    const ready = ids.filter((id) => !done.has(id) && indeg.get(id) === 0);
    if (ready.length === 0) {
      // cycle: append remaining (feedback loop) nodes as one final stage
      stages.push(ids.filter((id) => !done.has(id)));
      break;
    }
    stages.push(ready);
    for (const id of ready) {
      done.add(id);
      for (const next of adj.get(id) || []) indeg.set(next, indeg.get(next) - 1);
    }
    remaining -= ready.length;
  }
  return stages;
}

/**
 * Strongly connected components (Tarjan) — the feedback cycles of a free graph.
 * Returns an array of SCCs, each an array of node ids (size ≥ 1). Size-1 SCCs with no
 * self-loop are trivial (not feedback). Used by the compiler to emit negative-feedback
 * iterative loops: a component with >1 node (or a self-loop) is a real feedback cycle.
 */
export function scc(nodes, edges) {
  const ids = nodes.map((n) => n.id);
  const adj = new Map(ids.map((id) => [id, []]));
  const selfLoop = new Set();
  for (const e of edges || []) {
    if (e.source === e.target) selfLoop.add(e.source);
    if (!adj.has(e.source)) continue;
    adj.get(e.source).push(e.target);
  }
  let index = 0;
  const idx = new Map(), low = new Map(), onStack = new Set(), stack = [], out = [];
  const strongconnect = (v) => {
    idx.set(v, index); low.set(v, index); index++;
    stack.push(v); onStack.add(v);
    for (const w of adj.get(v) || []) {
      if (!idx.has(w)) { strongconnect(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (onStack.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
    }
    if (low.get(v) === idx.get(v)) {
      const comp = [];
      let w;
      do { w = stack.pop(); onStack.delete(w); comp.push(w); } while (w !== v);
      out.push(comp);
    }
  };
  for (const id of ids) if (!idx.has(id)) strongconnect(id);
  return out.map((comp) => ({ nodes: comp, feedback: comp.length > 1 || selfLoop.has(comp[0]) }));
}

/**
 * Free-graph execution decomposition for the compiler.
 * Returns { feedbackLoops: [SCC with >1 node or self-loop], acyclicOrder: [id,...] of
 * non-feedback nodes in dependency order }. The compiler renders feedbackLoops as
 * do-while convergence loops and acyclicOrder via parallel stages.
 */
export function graphDecompose(nodes, edges) {
  const comps = scc(nodes, edges);
  const feedbackNodes = new Set();
  const feedbackLoops = [];
  for (const c of comps) if (c.feedback) { feedbackLoops.push(c.nodes); for (const n of c.nodes) feedbackNodes.add(n); }
  const acyclic = nodes.filter((n) => !feedbackNodes.has(n.id));
  // order acyclic by Kahn (skip edges into feedback nodes)
  const acyclicOrder = [];
  const ids = acyclic.map((n) => n.id);
  const indeg = new Map(ids.map((id) => [id, 0]));
  const adj = new Map(ids.map((id) => [id, []]));
  for (const e of edges || []) {
    if (!indeg.has(e.source) || !indeg.has(e.target)) continue;
    adj.get(e.source).push(e.target);
    indeg.set(e.target, indeg.get(e.target) + 1);
  }
  const queue = ids.filter((id) => indeg.get(id) === 0);
  while (queue.length) {
    const cur = queue.shift();
    acyclicOrder.push(cur);
    for (const next of adj.get(cur) || []) { indeg.set(next, indeg.get(next) - 1); if (indeg.get(next) === 0) queue.push(next); }
  }
  for (const id of ids) if (!acyclicOrder.includes(id)) acyclicOrder.push(id);
  return { feedbackLoops, acyclicOrder };
}

/**
 * Interpret a Review edge's landing semantics (a Review node connecting to a target).
 *   target.kind === 'loop'  → loop-gate (score must meet threshold to pass)
 *   otherwise               → review-feedback (check/feedback on that target's work)
 * Returns the intent + a human description.
 */
export function reviewLanding(reviewNode, targetNode, { score = 0, threshold = 0.7, angle = "综合审核" } = {}) {
  const tk = targetNode?.kind;
  if (tk === "loop") {
    return { intent: "loop-gate", label: "Loop 评分闸门", detail: `Review 需返回评分 ≥ ${threshold} 才放行 Loop，否则继续循环。` };
  }
  return { intent: "review-feedback", label: `${angle}·检查反馈`, detail: `对「${targetNode?.title || targetNode?.id || "该节点"}」的工作做${angle}检查与反馈。` };
}

/**
 * Distinct review angles (agents/dimensions) that can be applied to a target.
 * When all are used, suggest a meta-review ("is this review reasonable?").
 */
export const REVIEW_ANGLES = [
  { angle: "功能完整性", agentId: "agent.reviewer", prompt: "检查功能是否完整、是否覆盖所有需求点。" },
  { angle: "正确性", agentId: "agent.reviewer", prompt: "核对结果是否准确、有无逻辑或计算错误。" },
  { angle: "风险与边界", agentId: "agent.reviewer", prompt: "审视潜在风险、异常输入与边界情况。" },
  { angle: "可读性与规范", agentId: "agent.reviewer", prompt: "评估结构清晰度、命名与规范一致性。" },
  { angle: "性能与资源", agentId: "agent.reviewer", prompt: "评估执行效率与资源占用是否合理。" }
];

/**
 * Suggest the next distinct review angle/agent for a target that already has
 * `existingAngles` applied — no duplication. When every base angle is used,
 * suggest a META-review ("检查这次检查是否合理") as a fresh, non-duplicate angle.
 */
export function suggestReview(existingAngles = [], { metaPrefix = "元审核" } = {}) {
  const used = new Set((Array.isArray(existingAngles) ? existingAngles : []).map((a) => String(a).trim()));
  for (const r of REVIEW_ANGLES) {
    if (!used.has(r.angle)) {
      return { angle: r.angle, agentId: r.agentId, prompt: r.prompt, meta: false };
    }
  }
  // all base angles used → meta-review
  let n = 1;
  let meta = `${metaPrefix} #${n}`;
  while (used.has(meta)) { n++; meta = `${metaPrefix} #${n}`; }
  return { angle: meta, agentId: "agent.reviewer", prompt: "检查上述各 Review 的检查角度是否合理、是否遗漏关键维度。", meta: true };
}

/** Compute next run id from a runtimes map (monotonic). */
export function nextRunIdTree(runtimes) {
  let max = 0;
  for (const rt of Object.values(runtimes || {})) for (const s of rt?.history || []) if (s?.runId > max) max = s.runId;
  return max + 1;
}

/** Summarize a node's branch output heuristically (prototype; real subagent replaces it). */
export function summarizeNodeTree(node, plan) {
  const kind = node?.kind || "action";
  const label = node?.title || kind;
  if (node?.out?.type === "file") return `「${label}」产出文件：${node.out.path || "（已生成）"}。`;
  const m = { research: "围绕目标输出调研要点与事实清单", summary: "汇总上游产出形成结构化分析", plan: "产出可分步执行的计划与分工", action: "执行并产出可用结果", review: "完成审核并记录结果", loop: "循环至通过评分闸门", dimension: "完成单维度审核" };
  return `「${label}」已完成：${m[kind] || "产出结果"}。`;
}

export { normalizeTree as default };
