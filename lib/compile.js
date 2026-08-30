// @dsh-local/dsh-workflow-studio — canvas tree → native DSH workflow script compiler (pure, unit-testable).
// The compiled script is executed by ctx.workflowEngine.start() so each node's agent() call
// spawns a REAL subagent, branches run in parallel, Loops gate on a review score, and each
// branch can return its own output (file bubble) instead of a unified report.
//
// Injection safety: every piece of user/agent text is embedded via JSON.stringify() (never
// template-literal interpolation), so quotes / backticks / ${} in content cannot break out
// of the generated JS.

import { roots, childrenOf, graphDecompose, reviewLanding, defaultAgentFor } from "./tree.js";

/** Escape any user string as a safe JS string literal. */
function jsStr(s) {
  return JSON.stringify(s == null ? "" : String(s));
}

/** Build one agent() call expression for a node. */
function agentCall(nodeId, node, agents, edgeInjects) {
  const agent = agents?.[node.agentId] || agents?.[defaultAgentFor(node.kind)];
  const rolePrompt = agent?.prompt || "";
  const promptParts = [];
  promptParts.push(`rolePrompt=${rolePrompt}`);
  promptParts.push(`nodeTitle=${node.title}`);
  promptParts.push(`nodePrompt=${node.prompt}`);
  // Edge intent injection: what upstream edges inject into this node's prompt.
  const injects = edgeInjects[nodeId] || [];
  if (injects.length) {
    promptParts.push(`injected=[${injects.join(" | ")}]`);
  }
  // Build the whole prompt as ONE JSON.stringify'd string (a plain double-quoted JS
  // literal), so backticks / ${} / quotes in any content are escaped and can never
  // break out of the generated script (injection safety).
  const promptExpr = jsStr(promptParts.join("\n"));
  const opts = [
    `label: ${jsStr(node.id)}`,
    `phase: ${jsStr(node.kind === "review" || node.kind === "dimension" ? "Review" : node.kind === "action" ? "Action" : "Plan")}`
  ];
  // Review / dimension / structured-action nodes request a schema so we can read pass/score.
  if (node.kind === "review" || node.kind === "dimension") {
    opts.push(`schema: { type: "object", properties: { pass: { type: "boolean" }, score: { type: "number" }, issues: { type: "array", items: { type: "string" } } }, required: ["pass", "score", "issues"] }`);
  }
  return `await agent(${promptExpr}, { ${opts.join(", ")} })`;
}

/**
 * Compile a normalized tree into a runnable workflow script body (a string).
 * Strategy:
 *  - Topologically group nodes into parallelStages.
 *  - Nodes in the same stage run in parallel via Promise.all.
 *  - Loop nodes (containers with a nested subGraph) run the WHOLE inner graph each
 *    iteration (a loop body may itself be a complex graph), gated by a review score;
 *    a plain loop node re-runs its single action. Re-run until gate passes or maxAttempts.
 *  - Return `{ [nodeId]: { summary, detail }, outputs: { nodeId: out } }` for bubble backfill.
 */

/** Compile a loop node's nested subGraph into a JS body (sequential over dependency order). */
function compileSubGraphBody(loopId, subGraph, agents, edgeInjects) {
  const nodes = Array.isArray(subGraph.nodes) ? subGraph.nodes : [];
  const edges = Array.isArray(subGraph.edges) ? subGraph.edges : [];
  if (!nodes.length) return "  let action = null;";
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const ids = nodes.map((n) => n.id);
  // order by Kahn (cycle-tolerant via append)
  const indeg = new Map(ids.map((id) => [id, 0]));
  const adj = new Map(ids.map((id) => [id, []]));
  for (const e of edges) {
    if (!indeg.has(e.source) || !indeg.has(e.target)) continue;
    adj.get(e.source).push(e.target);
    indeg.set(e.target, indeg.get(e.target) + 1);
  }
  const order = [];
  const q = ids.filter((id) => indeg.get(id) === 0);
  while (q.length) {
    const cur = q.shift();
    order.push(cur);
    for (const next of adj.get(cur) || []) { indeg.set(next, indeg.get(next) - 1); if (indeg.get(next) === 0) q.push(next); }
  }
  for (const id of ids) if (!order.includes(id)) order.push(id);
  const innerInjects = {};
  for (const e of edges) {
    const src = byId[e.source];
    if (!src) continue;
    (innerInjects[e.target] = innerInjects[e.target] || []).push(e.data?.detail || e.intent || "context");
  }
  const parts = order.map((id) => {
    const node = byId[id];
    const call = agentCall(id, node, agents, Object.assign({}, edgeInjects, innerInjects));
    return `  let ${varName(id)} = ${call};`;
  });
  return parts.join("\n");
}

export function compileTree(tree) {
  const { nodes, edges, agents, plan } = tree;
  if (!nodes || nodes.length === 0) {
    return `// empty workflow\nreturn { outputs: {} };`;
  }
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  // edge injects per target
  const edgeInjects = {};
  for (const e of edges || []) {
    const src = byId[e.source];
    if (!src) continue;
    const text = e.intent === "loop-gate" || e.intent === "review-feedback"
      ? `【${e.intent === "loop-gate" ? "Loop 评分" : "Review 反馈"}】来自「${src.title}」`
      : (e.data?.detail || e.intent);
    (edgeInjects[e.target] = edgeInjects[e.target] || []).push(text);
  }
  // loops: node whose action mode is loop → find incoming review-feedback/loop-gate edges
  const loopGates = {}; // nodeId -> [reviewNodeId,...]
  for (const e of edges || []) {
    if (e.intent === "loop-gate") (loopGates[e.target] = loopGates[e.target] || []).push(e.source);
  }

  const lines = [];
  lines.push(`const $res = {};`);
  lines.push(`const $out = {};`);
  lines.push(`const $plan = ${jsStr(plan || "")};`);

  // Declare loop review vars once.
  const loopNodes = nodes.filter((n) => n.loop?.mode === "loop" || n.kind === "loop");
  for (const ln of loopNodes) {
    lines.push(`let ${varName(ln.id)}_score = 0;`);
    lines.push(`let ${varName(ln.id)}_issues = [];`);
    lines.push(`let ${varName(ln.id)}_attempts = 0;`);
  }

  // Feedback SCCs (a node returning to a previous node = negative feedback): render each
  // as a do-while convergence loop so it keeps re-running until the gate passes / stabilizes.
  const { feedbackLoops, acyclicOrder } = graphDecompose(nodes, edges);
  const feedbackLoopSet = new Set();
  for (const comp of feedbackLoops) for (const id of comp) feedbackLoopSet.add(id);

  const renderAcyclicStage = (idList) => {
    const statements = idList.map((id) => {
      const node = byId[id];
      if (node.loop?.mode === "loop" || node.kind === "loop") {
        const gateIds = loopGates[id] || [];
        const { maxAttempts, threshold } = clampLoop(node);
        const gateAgentCalls = gateIds.map((gid) => agentCall(gid, byId[gid], agents, edgeInjects));
        // Loop body: if the loop node is a container with a nested graph, run the WHOLE
        // inner graph each iteration (a loop body may itself be a complex graph); else run
        // a single inner agent call.
        const isContainer = node.subGraph && Array.isArray(node.subGraph.nodes) && node.subGraph.nodes.length;
        const innerBody = isContainer
          ? compileSubGraphBody(node.id, node.subGraph, agents, edgeInjects)
          : `  let action = ${agentCall(id, node, agents, edgeInjects)};`;
        // Gate: for a container, gate reviews live INSIDE the subgraph (review/dimension
        // nodes whose result feeds the loop decision); use their score. Otherwise use the
        // external loop-gate reviews (gateAgentCalls).
        let gateExpr;
        if (isContainer) {
          const inner = Array.isArray(node.subGraph.nodes) ? node.subGraph.nodes : [];
          const innerGates = inner.filter((g) => g.kind === "review" || g.kind === "dimension").map((g) => varName(g.id));
          gateExpr = innerGates.length
            ? `(${innerGates.map((v) => `(${v} && typeof ${v}.score === "number" ? ${v}.score : 0)`).join(" + ")} / ${innerGates.length})`
            : "0";
        } else {
          gateExpr = gateAgentCalls.length
            ? `(${gateAgentCalls.map((c) => `(await ${c})`).join(" + ")} / ${gateAgentCalls.length})`
            : "0";
        }
        return [
          `do {`,
          `  ${varName(id)}_attempts += 1;`,
          innerBody,
          `  ${varName(id)}_score = ${gateExpr};`,
          `  ${varName(id)}_issues = [];`,
          `} while (${varName(id)}_score < ${threshold} && ${varName(id)}_attempts < ${maxAttempts});`,
          `$res[${jsStr(id)}] = { summary: ${jsStr(node.title)} + " 循环体完成（评分 " + ${varName(id)}_score.toFixed(2) + "）", detail: "循环体（嵌套图）执行完成" };`,
          `if (${varName(id)}_attempts >= ${maxAttempts} && ${varName(id)}_score < ${threshold}) { $res[${jsStr(id)}].flagged = true; }`
        ].join("\n");
      }
      const call = agentCall(id, node, agents, edgeInjects);
      if (node.kind === "review" || node.kind === "dimension") {
        return [
          `let ${varName(id)} = ${call};`,
          `$res[${jsStr(id)}] = { summary: ${jsStr(node.title)} + " 审核：评分 " + (${varName(id)} && typeof ${varName(id)}.score === "number" ? ${varName(id)}.score.toFixed(2) : "?") , detail: (${varName(id)} && Array.isArray(${varName(id)}.issues) ? ${varName(id)}.issues.join("; ") : "") || "通过" };`
        ].join("\n");
      }
      return [
        `let ${varName(id)} = ${call};`,
        `$res[${jsStr(id)}] = { summary: ${jsStr(node.title)} + " 完成", detail: typeof ${varName(id)} === "string" ? ${varName(id)} : JSON.stringify(${varName(id)}, null, 2) };`,
        node.out?.type === "file" ? `$out[${jsStr(id)}] = { type: "file", path: ${jsStr(node.out.path || "")}, text: ${jsStr(node.out.text || "")} };` : ""
      ].filter(Boolean).join("\n");
    });
    lines.push(`await Promise.all([\n  (async () => {\n${statements.map((s) => "    " + s).join("\n")}\n  })()\n]);`);
  };

  // Render acyclic nodes in dependency order (grouped by parallel stage).
  const byIdAcyclic = Object.fromEntries(nodes.filter((n) => !feedbackLoopSet.has(n.id)).map((n) => [n.id, n]));
  const acyclicIds = acyclicOrder.filter((id) => byIdAcyclic[id]);
  // group acyclic ids into stages by checking incoming edges from acyclic set
  const acyclicStageOf = {};
  for (const id of acyclicIds) {
    const preds = (edges || []).filter((e) => e.target === id && acyclicIds.includes(e.source));
    acyclicStageOf[id] = preds.length ? 1 + Math.max(...preds.map((p) => acyclicStageOf[p.source] || 0)) : 0;
  }
  const grouped = [];
  for (const id of acyclicIds) { const s = acyclicStageOf[id]; (grouped[s] = grouped[s] || []).push(id); }
  for (const stage of grouped) renderAcyclicStage(stage);

  // Render feedback loops (negative-feedback convergence) after their acyclic deps.
  for (const comp of feedbackLoops) {
    // Entry: prefer a non-review member (the work being iterated); fall back to first.
    const entry = comp.find((id) => byId[id]?.kind !== "review" && byId[id]?.kind !== "dimension") ?? comp[0];
    const { maxAttempts, threshold } = clampLoop(byId[entry]);
    const bodyCalls = comp.map((id) => {
      const node = byId[id];
      const call = agentCall(id, node, agents, edgeInjects);
      return `let ${varName(id)} = ${call};`;
    }).join("\n");
    // gate reviews inside the component (review/dimension members) — their score gates the loop
    const innerGateVars = comp.filter((id) => byId[id]?.kind === "review" || byId[id]?.kind === "dimension").map((id) => varName(id));
    const gateIds = loopGates[entry] || [];
    const hasGate = innerGateVars.length > 0 || gateIds.length > 0;
    lines.push(`let ${varName(entry)}_attempts = 0;`);
    lines.push(`let ${varName(entry)}_score = 0;`);
    lines.push(`do {`);
    lines.push(`  ${varName(entry)}_attempts += 1;`);
    lines.push(bodyCalls);
    if (innerGateVars.length) {
      lines.push(`  ${varName(entry)}_score = (${innerGateVars.map((v) => `(${v} && typeof ${v}.score === "number" ? ${v}.score : 0)`).join(" + ")} / ${innerGateVars.length});`);
    } else if (gateIds.length) {
      lines.push(`  const gate = [${gateIds.map((gid) => varName(gid)).join(", ")}];`);
      lines.push(`  ${varName(entry)}_score = gate.reduce((s,x)=>s+(x&&typeof x.score==="number"?x.score:0),0)/Math.max(1,gate.length);`);
    } else {
      lines.push(`  ${varName(entry)}_score = 1;`); // no gate → treat as converged in one pass
    }
    // Record a result for every member (actions/converged summary; reviews keep their own).
    for (const id of comp) {
      const node = byId[id];
      if (id === entry) {
        lines.push(`  $res[${jsStr(id)}] = { summary: ${jsStr(node.title)} + " 反馈收敛（第 " + ${varName(entry)}_attempts + " 轮，评分 " + ${varName(entry)}_score.toFixed(2) + "）", detail: "负反馈循环直至达标" };`);
      } else if (node.kind !== "review" && node.kind !== "dimension") {
        lines.push(`  $res[${jsStr(id)}] = { summary: ${jsStr(node.title)} + " 反馈收敛（随循环第 " + ${varName(entry)}_attempts + " 轮）", detail: "负反馈循环成员" };`);
      }
    }
    lines.push(`} while (${hasGate ? `${varName(entry)}_score < ${threshold}` : "false"} && ${varName(entry)}_attempts < ${maxAttempts});`);
    lines.push(`if (${varName(entry)}_attempts >= ${maxAttempts} && ${hasGate ? `${varName(entry)}_score < ${threshold}` : "false"}) { $res[${jsStr(entry)}].flagged = true; }`);
  }

  lines.push(`return { results: $res, outputs: $out, plan: $plan };`);
  return lines.join("\n");
}

/** Safe JS identifier derived from a node id. */
function varName(id) {
  const clean = String(id).replace(/[^A-Za-z0-9_]/g, "_");
  return `v${clean || "node"}`;
}

/** Clamp loop params to finite, safe ranges (rejects Infinity/NaN injection). */
function clampLoop(node) {
  const m = Number(node?.loop?.maxAttempts);
  const maxAttempts = Number.isFinite(m) ? Math.min(Math.max(1, Math.floor(m)), 100) : 3;
  const t = Number(node?.loop?.threshold);
  const threshold = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0.7;
  return { maxAttempts, threshold };
}

/** Build the WorkflowStartRequest's script + meta from a tree. */
export function compileToWorkflow(tree, { name, description } = {}) {
  const meta = {
    name: name || (typeof tree?.name === "string" ? tree.name : "dsh-workflow"),
    description: description || "由 dsh-workflow-studio 画布生成的工作流（Plan→Action→Review 树，分支并行）",
    phases: [{ title: "Plan" }, { title: "Action" }, { title: "Review" }]
  };
  return { script: compileTree(tree), meta };
}

export { compileTree as default };
