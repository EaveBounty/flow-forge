// @dsh-local/dsh-workflow-studio — unit tests for lib/tree.js and lib/compile.js.
import {
  makeNode, makeEdge, normalizeTree, childrenOf, roots, parallelStages,
  reviewLanding, nextRunIdTree, summarizeNodeTree, PRESET_AGENTS, suggestReview, REVIEW_ANGLES,
  scc, graphDecompose
} from "../lib/tree.js";
import { compileTree, compileToWorkflow } from "../lib/compile.js";

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.error(`  ✗ ${msg}`); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (${JSON.stringify(a)} vs ${JSON.stringify(b)})`); }
function newFn(script) { return new Function(script); } // only for validating generated code shape

// ---- tree.js ----
const root = makeNode("r", { kind: "root", title: "起点" });
const r1 = makeNode("r1", { kind: "research", title: "调研A", agentId: "agent.research" });
const r2 = makeNode("r2", { kind: "research", title: "调研B", agentId: "agent.research" });
const a = makeNode("a", { kind: "action", title: "执行", agentId: "agent.executor" });
const rv = makeNode("rv", { kind: "review", title: "审核", agentId: "agent.reviewer" });
const nodes = [root, r1, r2, a, rv];
const edges = [
  makeEdge("e1", "r", "r1", "context"),
  makeEdge("e2", "r", "r2", "context"),
  makeEdge("e3", "r1", "a", "artifact"),
  makeEdge("e4", "r2", "a", "artifact"),
  makeEdge("e5", "a", "rv", "review-feedback")
];

ok(childrenOf("r", nodes, edges).sort().join() === "r1,r2", "root children r1,r2");
eq(roots(nodes, edges), ["r"], "single root");
// parallel stages: stage0=[r], stage1=[r1,r2], stage2=[a], stage3=[rv]
const stages = parallelStages(nodes, edges);
ok(stages.length === 4, "4 stages");
ok(stages[1].sort().join() === "r1,r2", "r1,r2 parallel in same stage");
ok(stages[2][0] === "a", "action after both research");
ok(stages[3][0] === "rv", "review last");

// review landing semantics (user philosophy §5)
const loopNode = makeNode("lp", { kind: "loop", title: "Loop", loop: { mode: "loop", threshold: 0.8 } });
const onLoop = reviewLanding(rv, loopNode);
ok(onLoop.intent === "loop-gate", "review→loop is loop-gate");
const onAction = reviewLanding(rv, a);
ok(onAction.intent === "review-feedback", "review→action is review-feedback");

// normalize + custom agents
const custom = normalizeTree({ nodes, edges, agents: [{ id: "agent.custom", name: "自定义", role: "action", prompt: "hi" }] });
ok(custom.agents["agent.custom"] !== undefined, "custom agent kept");
ok(custom.agents["agent.research"] !== undefined, "preset agent kept");

// nextRunId
eq(nextRunIdTree({ x: { history: [{ runId: 3 }, { runId: 9 }] } }), 10, "nextRunId tree");
eq(nextRunIdTree({}), 1, "nextRunId empty");

// summarize per-branch file output
ok(summarizeNodeTree({ kind: "action", title: "出图", out: { type: "file", path: "/tmp/x.png" } }).includes("产出文件"), "file branch summary");

// multi-review smart suggestion (no duplication, meta-review rollover)
const s1 = suggestReview([]);
ok(!s1.meta && s1.angle === "功能完整性", "first suggestion is first base angle");
const s2 = suggestReview(["功能完整性", "正确性", "风险与边界", "可读性与规范", "性能与资源"]);
ok(s2.meta === true && s2.angle.startsWith("元审核"), "all base angles used → meta-review");
const s3 = suggestReview(REVIEW_ANGLES.map((r) => r.angle));
ok(s3.meta === true, "meta-review when all base used");
const s4 = suggestReview(["功能完整性", "元审核 #1"]);
ok(s4.angle === "正确性", "skips used, suggests next unused base angle");

// ---- free-graph model (user correction: NOT a tree, cycles allowed, single start) ----
// scc detection
const gNodes = [makeNode("s", { kind: "root", title: "起点" }), makeNode("a", { kind: "action", title: "A" }), makeNode("b", { kind: "action", title: "B" })];
const gCycle = [
  makeEdge("e1", "s", "a", "context"),
  makeEdge("e2", "a", "b", "artifact"),
  makeEdge("e3", "b", "a", "custom") // feedback: b returns to a (negative feedback loop)
];
const comps = scc(gNodes, gCycle);
const fb = comps.filter((c) => c.feedback);
ok(fb.length === 1, "one feedback SCC (a<->b)");
ok(fb[0].nodes.sort().join() === "a,b", "feedback SCC is a,b");
ok(comps.some((c) => !c.feedback && c.nodes[0] === "s"), "start node is its own trivial SCC");

// graphDecompose: feedback loop separated from acyclic skeleton
const dec = graphDecompose(gNodes, gCycle);
ok(dec.feedbackLoops.length === 1, "graphDecompose finds 1 feedback loop");
ok(dec.acyclicOrder.includes("s"), "start node in acyclic order");

// parallelStages is cycle-tolerant (no hang, all nodes present)
const ps = parallelStages(gNodes, gCycle);
ok(ps.length >= 1 && ps.flat().sort().join() === "a,b,s", "parallelStages cycle-tolerant, all nodes present");

// feedback cycle compile: do-while emitted, valid JS, no hang
const fbTree = { nodes: gNodes, edges: gCycle, agents: PRESET_AGENTS, plan: "" };
const fbCompiled = compileTree(fbTree);
ok(fbCompiled.includes("do {"), "feedback cycle emits do-while");
ok(validScript(fbCompiled), "feedback cycle compiled script parses");

// ---- Loop = loop-body container with a nested complex graph ----
const innerNodes = [
  makeNode("ia", { kind: "action", title: "内动作", agentId: "agent.executor" }),
  makeNode("irv", { kind: "review", title: "内审核", agentId: "agent.reviewer" })
];
const innerEdges = [makeEdge("ie1", "ia", "irv", "review-feedback")];
const loopBody = makeNode("lp", { kind: "loop", title: "循环体", loop: { mode: "loop", threshold: 0.8, maxAttempts: 4 }, subGraph: { nodes: innerNodes, edges: innerEdges } });
const outer = [makeNode("r", { kind: "root", title: "起点" }), loopBody];
const outerEdges = [makeEdge("o1", "r", "lp", "context")];
const loopBodyTree = { nodes: outer, edges: outerEdges, agents: PRESET_AGENTS, plan: "" };
const loopBodyCompiled = compileTree(loopBodyTree);
ok(loopBodyCompiled.includes("do {"), "loop-body container emits do-while");
ok(loopBodyCompiled.includes(varNameCheck("ia")) && loopBodyCompiled.includes(varNameCheck("irv")), "nested subgraph nodes compiled into loop body");
ok(validScript(loopBodyCompiled), "loop-body container compiled script parses");

// normalizeTree keeps subGraph
const withSub = normalizeTree({ nodes: [{ id: "lp2", kind: "loop", loop: { mode: "loop" }, subGraph: { nodes: innerNodes, edges: innerEdges } }], edges: [] });
ok(withSub.nodes[0].subGraph && withSub.nodes[0].subGraph.nodes.length === 2, "normalize keeps loop subGraph");

// ---- compile.js ----
// The generated script uses top-level await (workflow engine runs it as an async module).
// Validate by wrapping in an async function so `new Function` accepts it.
function validScript(script) {
  try { new Function(`return (async () => {\n${script}\n})`); return true; }
  catch (e) { console.error("script invalid:", e.message); return false; }
}
function varNameCheck(id) { return `v${String(id).replace(/[^A-Za-z0-9_]/g, "_")}`; }

// 1. compiled script is valid JS (parses)
const compiled = compileTree({ nodes, edges, agents: PRESET_AGENTS, plan: "做一个分析" });
ok(validScript(compiled), "compiled script parses as valid JS");
ok(compiled.includes("Promise.all"), "parallel Promise.all emitted");
ok(compiled.includes("await agent("), "agent() calls emitted");
ok(compiled.includes("$res[") && compiled.includes("$out"), "results/outputs maps emitted");

// 2. injection safety: malicious content stays a literal, doesn't break the script
const evilTree = { nodes: [makeNode("n1", { kind: "action", title: "x\"; throw 1; //", prompt: "` + evil + ${x} \\n" })], edges: [], agents: PRESET_AGENTS, plan: "''); malicious(" };
const evilCompiled = compileTree(evilTree);
ok(validScript(evilCompiled), "injection payload does not break generated script");

// 3. loop-gate compilation produces a do-while with score check
const loopTree = { nodes: [loopNode, rv], edges: [makeEdge("g", "rv", "lp", "loop-gate")], agents: PRESET_AGENTS, plan: "" };
const loopCompiled = compileTree(loopTree);
ok(loopCompiled.includes("do {"), "loop emits do-while");
ok(loopCompiled.includes("while (") && loopCompiled.includes("_score <"), "loop emits score gate while");
ok(validScript(loopCompiled), "loop compiled script parses");

// 4. compileToWorkflow meta shape
const wf = compileToWorkflow({ nodes, edges, agents: PRESET_AGENTS, name: "test", plan: "x" });
ok(typeof wf.script === "string" && wf.script.length > 0, "workflow script string");
ok(wf.meta.name === "test", "workflow meta name");
ok(Array.isArray(wf.meta.phases), "workflow meta phases");

console.log(`\ntree+compile tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
