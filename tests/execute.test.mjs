// @dsh-local/dsh-workflow-studio — end-to-end EXECUTION test.
// Compiles realistic graphs via lib/compile.js and ACTUALLY EXECUTES the generated
// script in a vm with stubbed agent()/parallel()/phase()/log() hooks, verifying that
// (a) the script runs without throwing and (b) results backfill per node correctly.
import { createContext, runInContext } from "node:vm";
import { makeNode, makeEdge, normalizeTree, PRESET_AGENTS } from "../lib/tree.js";
import { compileTree } from "../lib/compile.js";

let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.error("  ✗ " + m); } }

/** Execute a compiled workflow script with stub hooks; returns the script's return value. */
async function executeScript(script, { agentResponses = {}, plan = "" } = {}) {
  const calls = [];
  const sandbox = {
    console,
    args: { plan },
    agent: async (prompt, opts = {}) => {
      calls.push({ prompt, label: opts.label, phase: opts.phase, schema: opts.schema });
      const key = opts.label || "node";
      if (agentResponses[key] !== undefined) return agentResponses[key];
      if (opts.schema) return { pass: true, score: 1, issues: [] }; // structured default
      return "stub-result";
    },
    parallel: (thunks) => Promise.all(thunks.map((t) => t())),
    pipeline: () => { throw new Error("not used"); },
    phase: () => {},
    log: () => {}
  };
  const ctx = createContext(sandbox);
  // The compiled script ends with `return { results, outputs, plan }`. Wrap it in an async
  // IIFE (top-level await allowed inside) and await the returned Promise (its resolution
  // value is the script's return value).
  const wrapped = "(async () => {\n" + script + "\n})()";
  const promise = runInContext(wrapped, ctx);
  return await promise;
}

// ---- 1. simple linear Plan→Action→Review ----
{
  const tree = normalizeTree({
    nodes: [
      makeNode("p", { kind: "plan", title: "计划", agentId: "agent.planner" }),
      makeNode("a", { kind: "action", title: "执行", agentId: "agent.executor", out: { type: "file", path: "/tmp/out.md" } }),
      makeNode("r", { kind: "review", title: "审核", agentId: "agent.reviewer" })
    ],
    edges: [makeEdge("e1", "p", "a", "artifact"), makeEdge("e2", "a", "r", "review-feedback")],
    agents: PRESET_AGENTS, plan: "做一个功能"
  });
  const script = compileTree(tree);
  const out = await executeScript(script, { agentResponses: { r: { pass: true, score: 0.9, issues: ["ok"] } } });
  const results = out.results || {};
  const outputs = out.outputs || {};
  ok(results.p && results.a && results.r, "linear graph: all nodes have results");
  ok(outputs.a && outputs.a.type === "file", "linear graph: branch file output present");
  ok(results.p.summary.includes("完成"), "plan result summary");
}

// ---- 2. parallel branches from a single root ----
{
  const tree = normalizeTree({
    nodes: [
      makeNode("r", { kind: "root", title: "起点" }),
      makeNode("b1", { kind: "action", title: "分支1" }),
      makeNode("b2", { kind: "action", title: "分支2" }),
      makeNode("b3", { kind: "action", title: "分支3" })
    ],
    edges: [makeEdge("e1", "r", "b1", "context"), makeEdge("e2", "r", "b2", "context"), makeEdge("e3", "r", "b3", "context")],
    agents: PRESET_AGENTS, plan: ""
  });
  const script = compileTree(tree);
  const out = await executeScript(script);
  const results = out.results || {};
  ok(results.b1 && results.b2 && results.b3, "parallel branches all produce results");
  ok(script.includes("Promise.all"), "parallel emitted Promise.all");
}

// ---- 3. loop-body container with nested graph (gate = inner review score) ----
{
  const tree = normalizeTree({
    nodes: [
      makeNode("lp", {
        kind: "loop", title: "循环体", loop: { mode: "loop", threshold: 0.7, maxAttempts: 3 },
        subGraph: {
          nodes: [makeNode("ia", { kind: "action", title: "内动作" }), makeNode("irv", { kind: "review", title: "内审核" })],
          edges: [makeEdge("ie1", "ia", "irv", "review-feedback")]
        }
      })
    ],
    edges: [],
    agents: PRESET_AGENTS, plan: ""
  });
  const script = compileTree(tree);
  const out = await executeScript(script, { agentResponses: { irv: { pass: false, score: 0.4, issues: ["改"] } } });
  const results = out.results || {};
  ok(results.lp, "loop container produced a result");
  ok(results.lp.summary.includes("循环体"), "loop container summary mentions 循环体");
  ok(Number.isFinite(results.lp.summary && results.lp.summary.length), "loop container summary non-empty");
  // loop re-ran because gate score 0.4 < 0.7 → attempts incremented
  ok(script.includes("do {") && script.includes("_attempts"), "loop container emitted do-while with attempts");
}

// ---- 4. feedback cycle (negative feedback, node returns to a previous node) ----
{
  const tree = normalizeTree({
    nodes: [
      makeNode("a", { kind: "action", title: "A" }),
      makeNode("b", { kind: "review", title: "B审查" })
    ],
    edges: [makeEdge("e1", "a", "b", "review-feedback"), makeEdge("e2", "b", "a", "custom")],
    agents: PRESET_AGENTS, plan: ""
  });
  const script = compileTree(tree);
  ok(script.includes("do {"), "feedback cycle emits do-while");
  const out = await executeScript(script);
  ok(out.results && out.results.a, "feedback cycle produced result for a");
}

console.log(`\nexecution tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
