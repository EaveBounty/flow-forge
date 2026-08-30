import { test } from "node:test";
import assert from "node:assert/strict";
import { autoNodeName, autoEdgeSemantics, suggestNodeConfig, VISIBLE_MENU, CATEGORY_AGENTS, NODE_KINDS, EDGE_INTENTS, kindFacet } from "../lib/semantics.js";

test("VISIBLE_MENU is exactly the four user-mandated categories", () => {
	assert.deepEqual(VISIBLE_MENU, ["plan", "action", "review", "loop"]);
});

test("every visible category has default agents", () => {
	for (const k of VISIBLE_MENU) {
		assert.ok(Array.isArray(CATEGORY_AGENTS[k]) && CATEGORY_AGENTS[k].length > 0, k);
	}
});

test("autoNodeName produces a non-empty title + purpose for every kind", () => {
	for (const k of NODE_KINDS) {
		const r = autoNodeName(k);
		assert.equal(typeof r.title, "string");
		assert.ok(r.title.length > 0, k);
		assert.equal(typeof r.purpose, "string");
	}
});

test("autoNodeName uses a hint when provided", () => {
	const r = autoNodeName("action", { hint: "爬取竞品定价" });
	assert.equal(r.title, "爬取竞品定价");
});

test("autoNodeName references upstream title for review", () => {
	const r = autoNodeName("review", { upstream: ["写一份季度财报分析"] });
	assert.match(r.title, /季度财报分析/);
});

test("autoEdgeSemantics: review→loop is a loop-gate", () => {
	const s = autoEdgeSemantics("review", "loop");
	assert.equal(s.intent, "loop-gate");
	assert.match(s.detail, /评分/);
});

test("autoEdgeSemantics: review→action is review-feedback", () => {
	const s = autoEdgeSemantics("review", "action");
	assert.equal(s.intent, "review-feedback");
});

test("autoEdgeSemantics: action→review is artifact", () => {
	const s = autoEdgeSemantics("action", "review");
	assert.equal(s.intent, "artifact");
});

test("autoEdgeSemantics: plan→action is context", () => {
	const s = autoEdgeSemantics("plan", "action");
	assert.equal(s.intent, "context");
});

test("autoEdgeSemantics always returns a valid intent", () => {
	for (const f of NODE_KINDS) for (const t of NODE_KINDS) {
		const s = autoEdgeSemantics(f, t);
		assert.ok(EDGE_INTENTS.includes(s.intent), `${f}→${t}: ${s.intent}`);
		assert.ok(s.label && s.detail, `${f}→${t}`);
	}
});

test("suggestNodeConfig picks the category's default agent", () => {
	assert.equal(suggestNodeConfig("plan").agentId, "agent.planner");
	assert.equal(suggestNodeConfig("action").agentId, "agent.executor");
	assert.equal(suggestNodeConfig("review").agentId, "agent.reviewer");
	assert.equal(suggestNodeConfig("loop").agentId, "agent.executor");
});

test("kindFacet maps known kinds", () => {
	assert.equal(kindFacet("root"), "source");
	assert.equal(kindFacet("review"), "consumer");
	assert.equal(kindFacet("action"), "producer");
});
