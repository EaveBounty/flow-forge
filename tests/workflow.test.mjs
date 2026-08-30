// @dsh-local/dsh-workflow-studio — unit tests for lib/workflow.js pure logic.
// Run: node tests/workflow.test.mjs
import {
	normalizeWorkflow, edgeIntentCandidates, edgeAllowed, edgeKindLabel,
	dedupeReview, downstream, rollbackCascade, nextRunId, summarizeNode, topoSort
} from "../lib/workflow.js";
import { ID_PATTERN, workflowPath } from "../lib/index.js";

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error(`  ✗ ${msg}`); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (${JSON.stringify(a)} vs ${JSON.stringify(b)})`); }

// normalizeWorkflow
ok(normalizeWorkflow(null).status === "draft", "normalize null");
eq(normalizeWorkflow({ id: "x", name: "N", status: "done" }).name, "N", "normalize keeps name");
ok(normalizeWorkflow({ status: "bogus" }).status === "draft", "normalize bad status");

// edgeAllowed
ok(edgeAllowed("start", "research"), "start->research allowed");
ok(edgeAllowed("action", "review"), "action->review allowed");
ok(edgeAllowed("review", "action"), "review->action (rework) allowed");
ok(!edgeAllowed("action", "start"), "action->start denied");

// edgeIntentCandidates
const cands = edgeIntentCandidates({ kind: "start" }, { kind: "research" });
ok(cands.length >= 1, "start->research has candidates");
ok(cands.some((c) => c.kind === "research-focus"), "has research-focus");
const rew = edgeIntentCandidates({ kind: "review" }, { kind: "action" });
ok(rew.some((c) => c.kind === "rework-target"), "review->action has rework-target");

// edgeKindLabel
eq(edgeKindLabel("rework-target"), "返工", "kind label");

// dedupeReview
eq(dedupeReview([{ dimension: "a", issue: "x", pass: false }, { dimension: "a", issue: "x", pass: true }]).length, 1, "dedupe identical");
eq(dedupeReview([{ dimension: "a", issue: "x" }, { dimension: "b", issue: "y" }]).length, 2, "keep distinct");

// downstream
const edges = [
	{ source: "a", target: "b" }, { source: "b", target: "c" }, { source: "a", target: "d" }
];
eq([...downstream("a", edges)].sort(), ["b", "c", "d"], "downstream transitive");
eq(downstream("c", edges).length, 0, "downstream leaf");

// rollbackCascade
const runtimes = {
	a: { history: [{ runId: 1, status: "done" }, { runId: 2, status: "done" }], pointer: 1 },
	b: { history: [{ runId: 2, status: "done" }], pointer: 0 },
	c: { history: [{ runId: 2, status: "done" }], pointer: 0 }
};
const rb = rollbackCascade(["a", "b", "c"], edges, runtimes, "a", 0);
eq(rb.a.pointer, 0, "a pointer to 0");
eq(rb.b.history.length, 0, "b cascade cleared");
eq(rb.c.history.length, 0, "c cascade cleared");

// nextRunId
eq(nextRunId(runtimes), 3, "next run id");

// summarizeNode
ok(summarizeNode({ kind: "research", title: "调研" }, "目标").includes("调研"), "summarize research");

// Security: workflow id validation + path containment (C1)
const ID_OK = ["default", "my-workflow_2", "a1B2-C3"];
const ID_BAD = ["..", "../evil", "..\\..\\evil", "a/b", "a\\b", "a b", "", "x".repeat(65), "../..", "a..b/../c", null, undefined, 42, "a/b/../../x"];
for (const id of ID_OK) ok(workflowPath("C:\\x\\store", id) !== null, `id accepted: ${id}`);
for (const id of ID_BAD) ok(workflowPath("C:\\x\\store", id) === null, `id rejected: ${String(id)}`);
ok(workflowPath("C:\\x\\store", "default") === "C:\\x\\store\\default.json", "containment path resolve");
// ensure it never escapes a sibling prefix
const esc = workflowPath("C:\\x\\store", "..\\store2\\evil");
ok(esc === null, "traversal ..\\store2 rejected");

// nextRunId monotonic (F2)
eq(nextRunId({ a: { history: [{ runId: 5 }, { runId: 7 }] } }), 8, "next run id from max");
eq(nextRunId({}), 1, "next run id empty");

// normalize shape validation (F1)
const cleaned = normalizeWorkflow({
	id: "w", nodes: [{ id: "n1", kind: "action" }, { id: 42 }, "garbage"],
	edges: [{ source: "n1", target: "missing" }, { source: "n1", target: "n1" }, { source: "n1", target: 7 }]
});
eq(cleaned.nodes.length, 1, "normalize drops invalid nodes");
eq(cleaned.nodes[0].id, "n1", "keeps valid node");
eq(cleaned.nodes[0].kind, "action", "keeps kind");
eq(cleaned.edges.length, 0, "normalize drops invalid edges (dangling/self)");
ok(cleaned.nodes[0].pos.x === 60, "normalize assigns default pos");

// edgeAllowed whitelist (F5)
ok(edgeAllowed("start", "research"), "start->research");
ok(edgeAllowed("action", "review"), "action->review");
ok(edgeAllowed("review", "action"), "review->action rework");
ok(!edgeAllowed("action", "start"), "action->start denied");
ok(!edgeAllowed("start", "start"), "start->start denied");
ok(!edgeAllowed("review", "research"), "review->research denied (not in whitelist)");
ok(edgeAllowed("summary", "action"), "summary->action allowed");

// topoSort (F9/F10)
const topo = topoSort(
	[{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
	[{ source: "a", target: "b" }, { source: "b", target: "c" }, { source: "a", target: "d" }]
);
ok(topo.indexOf("a") < topo.indexOf("b"), "topo a before b");
ok(topo.indexOf("b") < topo.indexOf("c"), "topo b before c");
ok(topo.indexOf("a") < topo.indexOf("d"), "topo a before d");
// cycle safety
const cyc = topoSort([{ id: "x" }, { id: "y" }], [{ source: "x", target: "y" }, { source: "y", target: "x" }]);
eq(cyc.length, 2, "topo handles cycle without hang");
eq([...cyc].sort().join(""), "xy", "topo cycle includes all nodes");

console.log(`\nworkflow tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
