// @dsh-local/dsh-workflow-studio — host half.
// Exposes design-time + public REST endpoints to the web client AND external callers:
//   GET/POST /api/dsh-workflow-studio/workflow        → list / save workflows
//   POST      /api/dsh-workflow-studio/edge-intent     → candidate intents for an edge
//   POST      /api/dsh-workflow-studio/review-dedupe   → dedupe review findings
//   POST      /api/dsh-workflow-studio/semantic        → auto-name a node / edge (autonomy)
//   POST      /api/dsh-workflow-studio/v1/flows        → create a flow from an explicit tree (public API)
//   POST      /api/dsh-workflow-studio/v1/flows/generate → create a flow from natural language
//   GET       /api/dsh-workflow-studio/v1/menu         → the 4 categories + their default agents
// Plus a sessionProjection for live token/cache stats.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join, basename, extname, resolve, sep } from "node:path";
import { z as zodZ } from "zod";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { normalizeWorkflow, edgeIntentCandidates, edgeAllowed, dedupeReview, rollbackCascade, nextRunId, summarizeNode, downstream, topoSort } from "./workflow.js";
import { normalizeTree, PRESET_AGENTS, reviewLanding, suggestReview, summarizeNodeTree } from "./tree.js";
import { compileToWorkflow } from "./compile.js";
import { autoNodeName, autoEdgeSemantics, suggestNodeConfig, VISIBLE_MENU, CATEGORY_AGENTS } from "./semantics.js";

// Native workflow engine self-mount (path B): the web profile disables the host-plane
// workflow-worker-thread by default, so ctx.get('workflowEngine') is undefined. We
// feature-detect and instantiate it ourselves (the Cordis Service constructor auto-
// provides `workflowEngine`). Wrapped in a lazy dynamic import so the plugin still
// loads if the package is absent on older DSH installs.
let WorkflowEngineCtor = null;
async function mountWorkflowEngine(ctx) {
	if (ctx.get("workflowEngine") !== undefined) return true; // already provided
	try {
		if (WorkflowEngineCtor === null) {
			const mod = await import("@deepseek-ai/dsh-workflow-worker-thread");
			WorkflowEngineCtor = mod.default || mod.WorkerThreadWorkflowEngine;
		}
		if (typeof WorkflowEngineCtor !== "function") return false;
		new WorkflowEngineCtor(ctx, { provider: "spawn" });
		return true;
	} catch { return false; }
}

const name = "workflow-studio";
const inject = ["webServer", "sessionProjections", "agents"];const PROFILE = "web";

// Hard security bounds. See docs/AUDIT.md C1/C2/M1/L1/L2.
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const WORKFLOW_LIST_CAP = 200;
const MAX_NODES = 500;      // per-workflow node cap (DoS guard at the v1 write boundary)
const MAX_EDGES = 2000;     // per-workflow edge cap
const MAX_STORED = 500;     // store quota — reject writes that would exceed this

function storeDir(dshHome) {
	return process.env.DSH_WORKFLOW_DIR || join(dshHome, "profiles", PROFILE, ".dsh-workflow");
}

function listWorkflows(dshHome) {
	const dir = storeDir(dshHome);
	if (!existsSync(dir)) return [];
	return readdirSync(dir).filter((f) => extname(f) === ".json").slice(0, WORKFLOW_LIST_CAP).map((f) => {
		try { return normalizeWorkflow(JSON.parse(readFileSync(join(dir, f), "utf8"))); }
		catch { return null; }
	}).filter(Boolean);
}

/** Resolve the absolute file path for a workflow id, enforcing strict id shape + containment. */
function workflowPath(dir, id) {
	if (typeof id !== "string" || !ID_PATTERN.test(id)) return null;
	const file = resolve(dir, `${id}.json`);
	if (file !== dir && !file.startsWith(dir + sep)) return null; // path containment
	return file;
}

function saveWorkflow(dshHome, body) {
	const wf = normalizeWorkflow(body);
	if (Array.isArray(wf.nodes) && wf.nodes.length > MAX_NODES) throw Object.assign(new Error("too many nodes"), { code: "TOO_MANY" });
	if (Array.isArray(wf.edges) && wf.edges.length > MAX_EDGES) throw Object.assign(new Error("too many edges"), { code: "TOO_MANY" });
	const dir = storeDir(dshHome);
	mkdirSync(dir, { recursive: true });
	// Store quota: block writes that would exceed the cap (new ids only).
	if (existsSync(dir)) {
		const count = readdirSync(dir).filter((f) => extname(f) === ".json").length;
		const file = workflowPath(dir, wf.id);
		if (count >= MAX_STORED && file && !existsSync(file)) throw Object.assign(new Error("store quota exceeded"), { code: "QUOTA" });
	}
	const file = workflowPath(dir, wf.id);
	if (!file) throw Object.assign(new Error("invalid workflow id"), { code: "BAD_ID" });
	writeFileSync(file, JSON.stringify(wf, null, 2), "utf8");
	return wf;
}

function json(res, code, obj) {
	res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
	res.end(JSON.stringify(obj));
}

/** True when the request body claims to be JSON (CSRF guard for write endpoints). */
function isJsonRequest(req) {
	const ct = String(req.headers["content-type"] || "").toLowerCase();
	return ct.includes("application/json") || ct === "";
}

/** Redact sensitive fields for unauthenticated list responses. */
function redact(workflows) {
	return (Array.isArray(workflows) ? workflows : []).map((w) => ({
		id: w.id, name: w.name, status: w.status,
		nodeCount: Array.isArray(w.nodes) ? w.nodes.length : 0,
		edgeCount: Array.isArray(w.edges) ? w.edges.length : 0
	}));
}

/** Generic error object so absolute paths / internals never leak to clients (L1). */
function publicError(err) {
	return { ok: false, error: "internal" };
}

function readBody(req) {
	return new Promise((resolve) => {
		const chunks = [];
		let total = 0;
		let settled = false;
		const done = (value) => {
			if (settled) return;
			settled = true;
			resolve(value);
		};
		req.on("data", (c) => {
			total += c.length;
			if (total > MAX_BODY_BYTES) {
				req.removeAllListeners("data");
				req.destroy();
				done({ __tooLarge: true });
				return;
			}
			chunks.push(c);
		});
		req.on("end", () => {
			try {
				if (chunks.length === 0) { done({}); return; }
				done(JSON.parse(Buffer.concat(chunks).toString("utf8")));
			} catch { done({}); }
		});
		req.on("close", () => done({}));
		req.on("error", () => done({}));
	});
}

function apply(ctx) {
	ctx.effect(() => {
		ctx.sessionProjections.register({
			key: "workflowStudioStats",
			stateVersion: 1,
			schema: zodZ.object({
				input: zodZ.number().nonnegative(),
				cacheRead: zodZ.number().nonnegative(),
				cacheWrite: zodZ.number().nonnegative(),
				output: zodZ.number().nonnegative(),
				reasoning: zodZ.number().nonnegative()
			}),
			init: () => ({ input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 }),
			apply: (state, event) => {
				const d = event.data;
				if (event.type === "assistant/chunk" && d?.chunk?.type === "usage" && d.chunk.usage) {
					const u = d.chunk.usage;
					return {
						input: state.input + (u.inputTokens ?? 0),
						cacheRead: state.cacheRead + (u.cacheReadTokens ?? 0),
						cacheWrite: state.cacheWrite + (u.cacheWriteTokens ?? 0),
						output: state.output + (u.outputTokens ?? 0),
						reasoning: state.reasoning + (u.reasoningTokens ?? 0)
					};
				}
				return state;
			},
			view: (state) => state
		});
	}, "workflow-studio: session projection");

	ctx.effect(() => {
		ctx.webServer.register({
			kind: "exact",
			path: "/api/dsh-workflow-studio/workflow",
			handler: async (req, res) => {
				try {
					const dshHome = resolveDshHome();
					if (req.method === "GET" || req.method === "HEAD") {
						json(res, 200, { ok: true, workflows: redact(listWorkflows(dshHome)) });
						return;
					}
					if (req.method === "POST") {
						if (!isJsonRequest(req)) { json(res, 415, { ok: false, error: "content-type must be application/json" }); return; }
						const body = await readBody(req);
						if (body && body.__tooLarge) { json(res, 413, { ok: false, error: "body too large" }); return; }
						const wf = saveWorkflow(dshHome, body);
						json(res, 200, { ok: true, workflow: wf });
						return;
					}
					json(res, 405, { ok: false, error: "method not allowed" });
				} catch (error) {
					if (error && error.code === "BAD_ID") { json(res, 400, { ok: false, error: "invalid workflow id" }); return; }
					if (error && (error.code === "TOO_MANY" || error.code === "QUOTA")) { json(res, 422, { ok: false, error: error.message }); return; }
					json(res, 500, publicError(error));
				}
			}
		});
	}, "workflow-studio: /api/dsh-workflow-studio/workflow");

	ctx.effect(() => {
		ctx.webServer.register({
			kind: "exact",
			path: "/api/dsh-workflow-studio/edge-intent",
			handler: async (req, res) => {
				try {
					if (req.method !== "POST") { json(res, 405, { ok: false }); return; }
					const b = await readBody(req);
					if (b && b.__tooLarge) { json(res, 413, { ok: false, error: "body too large" }); return; }
					const allowed = edgeAllowed(String(b.fromKind ?? ""), String(b.toKind ?? ""));
					const candidates = allowed
						? edgeIntentCandidates(
							{ kind: String(b.fromKind ?? "") },
							{ kind: String(b.toKind ?? "") },
							{ plan: typeof b.plan === "string" ? b.plan : "" }
						)
						: [];
					json(res, 200, { ok: true, allowed, candidates });
				} catch (error) {
					json(res, 500, publicError(error));
				}
			}
		});
	}, "workflow-studio: /api/dsh-workflow-studio/edge-intent");

	ctx.effect(() => {
		ctx.webServer.register({
			kind: "exact",
			path: "/api/dsh-workflow-studio/summarize",
			handler: async (req, res) => {
				try {
					if (req.method !== "POST") { json(res, 405, { ok: false }); return; }
					const b = await readBody(req);
					if (b && b.__tooLarge) { json(res, 413, { ok: false, error: "body too large" }); return; }
					const node = b.node || {};
					const plan = typeof b.plan === "string" ? b.plan : "";
					json(res, 200, { ok: true, summary: summarizeNode(node, plan), detail: summarizeNode(node, plan) + "（详细执行汇报待接入 DSH 子代理后生成）" });
				} catch (error) {
					json(res, 500, publicError(error));
				}
			}
		});
	}, "workflow-studio: /api/dsh-workflow-studio/summarize");

	ctx.effect(() => {
		ctx.webServer.register({
			kind: "exact",
			path: "/api/dsh-workflow-studio/review-dedupe",
			handler: async (req, res) => {
				try {
					if (req.method !== "POST") { json(res, 405, { ok: false }); return; }
					const b = await readBody(req);
					if (b && b.__tooLarge) { json(res, 413, { ok: false, error: "body too large" }); return; }
					json(res, 200, { ok: true, reviews: dedupeReview(Array.isArray(b.reviews) ? b.reviews : []) });
				} catch (error) {
					json(res, 500, publicError(error));
				}
			}
		});
	}, "workflow-studio: /api/dsh-workflow-studio/review-dedupe");

	// ── Native execution: compile a tree and run it via ctx.workflowEngine ───────────
	ctx.effect(() => {
		ctx.webServer.register({
			kind: "exact",
			path: "/api/dsh-workflow-studio/run",
			handler: async (req, res) => {
				try {
					if (req.method !== "POST") { json(res, 405, { ok: false }); return; }
					const b = await readBody(req);
					if (b && b.__tooLarge) { json(res, 413, { ok: false, error: "body too large" }); return; }
					// Try to self-mount the native engine if the profile hasn't enabled it.
					await mountWorkflowEngine(ctx);
					const engine = ctx.get("workflowEngine");
					if (engine === undefined) {
						json(res, 501, { ok: false, error: "native workflowEngine not enabled", simulation: true });
						return;
					}
					const sessionId = typeof b.sessionId === "string" ? b.sessionId : "";
					const parent = sessionId ? ctx.agents?.get(sessionId) : undefined;
					if (!parent) {
						json(res, 400, { ok: false, error: "no live agent for session", simulation: true });
						return;
					}
					const tree = normalizeTree(b.tree || b);
					const { script, meta } = compileToWorkflow(tree, b.meta);
					const run = engine.start({
						script,
						meta,
						args: { plan: tree.plan },
						parent,
						...(typeof b.maxTotalAgents === "number" ? { maxTotalAgents: b.maxTotalAgents } : {})
					});
					const result = await run.result;
					try { await run.dispose(); } catch { /* dispose is best-effort */ }
					json(res, 200, {
						ok: true,
						runId: run.id,
						stopReason: result.stopReason,
						agentsStarted: result.agentsStarted,
						value: result.value
					});
				} catch (error) {
					json(res, 500, publicError(error));
				}
			}
		});
	}, "workflow-studio: /api/dsh-workflow-studio/run");

	// ── Agent registry (presets + user customs) ─────────────────────────────────────
	ctx.effect(() => {
		ctx.webServer.register({
			kind: "exact",
			path: "/api/dsh-workflow-studio/agents",
			handler: async (req, res) => {
				try {
					if (req.method === "GET" || req.method === "HEAD") {
						json(res, 200, { ok: true, agents: Object.values(PRESET_AGENTS) });
						return;
					}
					json(res, 405, { ok: false, error: "method not allowed" });
				} catch (error) {
					json(res, 500, publicError(error));
				}
			}
		});
	}, "workflow-studio: /api/dsh-workflow-studio/agents");

	// ── Semantic auto-naming (node + edge) — the "autonomy/intelligence" endpoint ─────
	ctx.effect(() => {
		ctx.webServer.register({
			kind: "exact",
			path: "/api/dsh-workflow-studio/semantic",
			handler: async (req, res) => {
				try {
					if (req.method !== "POST") { json(res, 405, { ok: false }); return; }
					const b = await readBody(req);
					if (b && b.__tooLarge) { json(res, 413, { ok: false, error: "body too large" }); return; }
					if (b && b.edge) {
						const s = autoEdgeSemantics(b.edge.fromKind, b.edge.toKind, { fromTitle: b.edge.fromTitle, toTitle: b.edge.toTitle });
						json(res, 200, { ok: true, edge: s });
						return;
					}
					const s = suggestNodeConfig(b.node?.kind || b.kind, { hint: b.node?.hint, upstream: b.node?.upstream });
					json(res, 200, { ok: true, node: s });
				} catch (error) {
					json(res, 500, publicError(error));
				}
			}
		});
	}, "workflow-studio: /api/dsh-workflow-studio/semantic");

	// ── Public REST API for external callers (friends / other apps) to create flows. ──
	//   POST /api/dsh-workflow-studio/v1/flows           → create a flow from an explicit tree
	//   POST /api/dsh-workflow-studio/v1/flows/generate  → create a flow from natural language
	//   GET  /api/dsh-workflow-studio/v1/menu            → the 4 categories + their default agents
	// These are the "接口化部署" the user asked for: external clients POST a spec and get a
	// persisted, runnable workflow back — nothing hardcoded on their side.
	ctx.effect(() => {
		ctx.webServer.register({
			kind: "exact",
			path: "/api/dsh-workflow-studio/v1/flows",
			handler: async (req, res) => {
				try {
					if (req.method === "GET" || req.method === "HEAD") {
						json(res, 200, { ok: true, workflows: redact(listWorkflows(resolveDshHome())) });
						return;
					}
					if (req.method === "POST") {
						if (!isJsonRequest(req)) { json(res, 415, { ok: false, error: "content-type must be application/json" }); return; }
						const b = await readBody(req);
						if (b && b.__tooLarge) { json(res, 413, { ok: false, error: "body too large" }); return; }
						// Accept either a tree spec ({nodes,edges,agents,plan}) or {tree: {...}}.
						const spec = b && b.tree && typeof b.tree === "object" ? b.tree : b;
						const tree = normalizeTree(spec);
						if (!tree.nodes.length) { json(res, 400, { ok: false, error: "no valid nodes" }); return; }
						const saved = saveWorkflow(resolveDshHome(), {
							...tree,
							id: b.id || tree.id || "flow-" + Date.now().toString(36),
							name: b.name || tree.name || "外部创建工作流"
						});
						// Compile as a readiness signal (does not run). Surface a sanitized reason.
						let compiled = false, compileError = null;
						try { compileToWorkflow(tree, { phases: [] }); compiled = true; } catch (e) { compileError = "workflow is not runnable (invalid graph structure)"; }
						json(res, 201, { ok: true, workflow: saved, compiled, compileError });
						return;
					}
					json(res, 405, { ok: false, error: "method not allowed" });
				} catch (error) {
					if (error && error.code === "BAD_ID") { json(res, 400, { ok: false, error: "invalid workflow id" }); return; }
					if (error && (error.code === "TOO_MANY" || error.code === "QUOTA")) { json(res, 422, { ok: false, error: error.message }); return; }
					json(res, 500, publicError(error));
				}
			}
		});
	}, "workflow-studio: /api/dsh-workflow-studio/v1/flows");

	ctx.effect(() => {
		ctx.webServer.register({
			kind: "exact",
			path: "/api/dsh-workflow-studio/v1/flows/generate",
			handler: async (req, res) => {
				try {
					if (req.method !== "POST") { json(res, 405, { ok: false }); return; }
					if (!isJsonRequest(req)) { json(res, 415, { ok: false, error: "content-type must be application/json" }); return; }
					const b = await readBody(req);
					if (b && b.__tooLarge) { json(res, 413, { ok: false, error: "body too large" }); return; }
					const prompt = typeof b?.prompt === "string" ? b.prompt : "";
					if (!prompt.trim()) { json(res, 400, { ok: false, error: "prompt required" }); return; }
					// Prefer the live session generator when a session is provided (in-app),
					// else fall back to the host-side heuristic builder (external callers).
					const subagents = ctx.get("subagents");
					const sid = typeof b?.sessionId === "string" && b.sessionId ? b.sessionId : "";
					const parent = sid ? ctx.agents?.get(sid) : undefined;
					if (subagents && parent) {
						try {
							const providers = subagents.list ? subagents.list() : [];
							const providerName = providers.includes("spawn") ? "spawn" : (providers[0] || "spawn");
							const run = await subagents.start(providerName, { label: "workflow-generate-v1", prompt: buildGeneratePrompt(prompt), parent });
							let sub; try { sub = await run.result; } finally { if (typeof run.dispose === "function") { try { await run.dispose(); } catch {} } }
							const blocks = Array.isArray(sub?.output) ? sub.output : [];
							const text = blocks.map((blk) => (blk && typeof blk === "object" && "text" in blk ? String(blk.text) : "")).join("\n").trim();
							try {
								const parsed = JSON.parse(String(text).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim());
								const tree = treeFromChildren(parsed);
								if (tree.nodes.length) { json(res, 200, { ok: true, tree }); return; }
							} catch { /* fall through to heuristic */ }
						} catch { /* subagent path failed — fall through to heuristic */ }
					}
					// Host-side heuristic generator (no session / subagent needed) — pure & deployable.
					const tree = heuristicGenerate(prompt);
					if (tree.nodes.length) { json(res, 200, { ok: true, tree }); return; }
					json(res, 502, { ok: false, error: "could not generate flow" });
				} catch (error) {
					json(res, 500, publicError(error));
				}
			}
		});
	}, "workflow-studio: /api/dsh-workflow-studio/v1/flows/generate");

	ctx.effect(() => {
		ctx.webServer.register({
			kind: "exact",
			path: "/api/dsh-workflow-studio/v1/menu",
			handler: async (req, res) => {
				try {
					if (req.method !== "GET" && req.method !== "HEAD") { json(res, 405, { ok: false }); return; }
					json(res, 200, { ok: true, categories: VISIBLE_MENU.map((k) => ({ key: k, defaultAgents: (CATEGORY_AGENTS[k] || []).map((id) => PRESET_AGENTS[id]).filter(Boolean) })) });
				} catch (error) {
					json(res, 500, publicError(error));
				}
			}
		});
	}, "workflow-studio: /api/dsh-workflow-studio/v1/menu");


	ctx.effect(() => {
		ctx.webServer.register({
			kind: "exact",
			path: "/api/dsh-workflow-studio/review-landing",
			handler: async (req, res) => {
				try {
					if (req.method !== "POST") { json(res, 405, { ok: false }); return; }
					const b = await readBody(req);
					if (b && b.__tooLarge) { json(res, 413, { ok: false, error: "body too large" }); return; }
					const landing = reviewLanding(
						{ kind: b.reviewKind },
						{ kind: b.targetKind, title: b.targetTitle },
						{ score: b.score, threshold: b.threshold, angle: b.angle }
					);
					json(res, 200, { ok: true, ...landing });
				} catch (error) {
					json(res, 500, publicError(error));
				}
			}
		});
	}, "workflow-studio: /api/dsh-workflow-studio/review-landing");

	// ── Suggest the next non-duplicate review angle for a target ────────────────────
	ctx.effect(() => {
		ctx.webServer.register({
			kind: "exact",
			path: "/api/dsh-workflow-studio/review-suggest",
			handler: async (req, res) => {
				try {
					if (req.method !== "POST") { json(res, 405, { ok: false }); return; }
					const b = await readBody(req);
					if (b && b.__tooLarge) { json(res, 413, { ok: false, error: "body too large" }); return; }
					const suggestion = suggestReview(b.existingAngles);
					json(res, 200, { ok: true, ...suggestion });
				} catch (error) {
					json(res, 500, publicError(error));
				}
			}
		});
	}, "workflow-studio: /api/dsh-workflow-studio/review-suggest");

	// ── Conversation → tree generation via a subagent (AI builds the tree) ───────────
	ctx.effect(() => {
		ctx.webServer.register({
			kind: "exact",
			path: "/api/dsh-workflow-studio/generate",
			handler: async (req, res) => {
				try {
					if (req.method !== "POST") { json(res, 405, { ok: false }); return; }
					const b = await readBody(req);
					if (b && b.__tooLarge) { json(res, 413, { ok: false, error: "body too large" }); return; }
					const subagents = ctx.get("subagents");
					if (!subagents || !sessionId(b)) {
						json(res, 501, { ok: false, error: "generation requires a live session + subagent registry" });
						return;
					}
					const sessionId = typeof b.sessionId === "string" ? b.sessionId : "";
					const parent = ctx.agents?.get(sessionId);
					if (!parent) { json(res, 400, { ok: false, error: "no live agent for session" }); return; }
					const prompt = buildGeneratePrompt(typeof b.prompt === "string" ? b.prompt : "");
					const providers = subagents.list ? subagents.list() : [];
					const providerName = providers.includes("spawn") ? "spawn" : (providers[0] || "spawn");
					const run = await subagents.start(providerName, {
						label: "workflow-generate",
						prompt,
						parent
					});
					let sub;
					try {
						sub = await run.result; // Promise<SubagentResult>; never rejects on child failure
					} finally {
						if (typeof run.dispose === "function") { try { await run.dispose(); } catch { /* cleanup */ } }
					}
					const blocks = Array.isArray(sub?.output) ? sub.output : [];
					const text = blocks.map((blk) => (blk && typeof blk === "object" && "text" in blk ? String(blk.text) : "")).join("\n").trim();
					let tree;
					try {
						// strip surrounding markdown fence if present
						const jsonText = String(text).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
						const parsed = JSON.parse(jsonText);
						// normalize nested children into flat nodes+edges (host-side helper below)
						tree = treeFromChildren(parsed);
					} catch (e) {
						json(res, 502, { ok: false, error: "generation returned invalid tree" });
						return;
					}
					json(res, 200, { ok: true, tree });
				} catch (error) {
					json(res, 500, publicError(error));
				}
			}
		});
	}, "workflow-studio: /api/dsh-workflow-studio/generate");
}

function sessionId(b) {
	return typeof b === "object" && b !== null && typeof b.sessionId === "string" && b.sessionId;
}

/** Build the subagent prompt that turns natural language into a tree JSON. */
function buildGeneratePrompt(prompt) {
	return `你是 DSH 工作流架构师。把下面这段用户需求，拆解成一棵「从起点无限生长的任务树」，输出为纯 JSON（不要 Markdown 代码块）。

可用节点 kind：root, plan, action, review, summary, dimension, loop。
要求：
- 必须有且仅有一个 root 节点作为起点。
- root 下分若干分支（branch），分支之间应互相独立、可并行。
- action 节点可带 loop 模式（{mode:"loop",threshold:0.7,maxAttempts:3}）。
- 关键节点可挂 review 子节点（检查反馈）；loop 节点可被 review 以 loop-gate 语义门控。
- 每个节点可指定 agentId（预设：agent.research/agent.analyst/agent.planner/agent.executor/agent.reviewer）或自定义 {id,name,role,prompt}。
- 若某分支最后要产出文件，给该 action 设 out:{type:"file",path:"<建议路径>"}。
- 所有 title/prompt 用中文。

返回 JSON 结构：
{"nodes":[{"id":"r","kind":"root","title":"起点","pos":{"x":200,"y":60},"children":[{"id":"n1","kind":"action","title":"...","agentId":"...","prompt":"...","out":null,"loop":null,"children":[...]}]}],"agents":[可选自定义agent...]}

用户需求：
${typeof prompt === "string" ? prompt : ""}

只输出上述 JSON，不要解释。children 递归结构即树的生长方式。`;
}

/**
 * Pure host-side heuristic generator (no session / subagent). Splits free text into
 * steps and lays out a root → plan → parallel actions → review → (loop) → summary tree.
 * Keeps the plugin fully deployable for external REST callers.
 */
function heuristicGenerate(text) {
	const s = String(text || "").replace(/\r/g, "").trim();
	const steps = s.split("\n").map((l) => l.trim()).filter((l) => l.length > 1).map((l) => l.replace(/^\d+[.、)．]|^[-*•]\s*/, "").trim()).filter(Boolean);
	const seq = steps.length >= 2 ? steps.slice(0, 6) : (s.split(/[。；;\n]+/).map((x) => x.trim()).filter((x) => x.length > 1).slice(0, 6));
	if (!seq.length) seq.push(s.slice(0, 60));
	const hasLoop = /循环|迭代|loop|iterate|直到|反复/i.test(s);
	const nodes = [], edges = [];
	let eid = 0;
	const add = (n) => nodes.push(n);
	const link = (a, b, intent) => edges.push({ id: "e" + eid++, source: a, target: b, intent, data: {} });
	const mk = (kind, title, agentId, x, y, extra) => {
		const id = "n" + (nodes.length + 1);
		add({ id, kind, title: title || kind, agentId: agentId || "agent.executor", prompt: title || "", files: [], review: [], loop: kind === "loop" ? { mode: "loop", threshold: 0.7, maxAttempts: 3 } : {}, out: null, pos: { x, y }, ...(extra || {}) });
		return id;
	};
	const root = mk("root", "流程起点", "agent.planner", 200, 40);
	const plan = mk("plan", "规划与拆解", "agent.planner", 200, 180);
	link(root, plan, "context");
	const w = 210, startX = 200 - ((seq.length - 1) * w) / 2;
	const actionIds = seq.map((step, i) => {
		const kind = hasLoop && i === seq.length - 1 ? "loop" : "action";
		const id = mk(kind, step, kind === "loop" ? "agent.executor" : "agent.executor", startX + i * w, 360);
		link(plan, id, "artifact");
		return id;
	});
	const review = mk("review", "综合审核", "agent.reviewer", 200, 560);
	actionIds.forEach((id) => link(id, review, "artifact"));
	if (hasLoop && actionIds.length) link(review, actionIds[actionIds.length - 1], "loop-gate");
	const summary = mk("summary", "汇总产出", "agent.analyst", 200, 740);
	link(review, summary, "artifact");
	return { id: "heuristic-1", name: "生成的工作流", nodes, edges, agents: [], plan: s, status: "draft" };
}

/** Convert a nested {nodes:[{...children}]} AI response into flat {nodes,edges}. */
function treeFromChildren(parsed) {
	const flatNodes = [];
	const flatEdges = [];
	let edgeSeq = 0;
	const walk = (node, parentId) => {
		const id = typeof node.id === "string" && node.id ? node.id : `n${flatNodes.length + 1}`;
		flatNodes.push({
			id, kind: node.kind || "action", title: node.title || id, agentId: node.agentId || "",
			prompt: node.prompt || "", pos: node.pos || { x: 200 + flatNodes.length * 30, y: 60 + flatNodes.length * 60 },
			loop: node.loop || null, out: node.out || null
		});
		if (parentId) flatEdges.push({ id: `e${edgeSeq++}`, source: parentId, target: id, intent: "context", data: {} });
		for (const child of Array.isArray(node.children) ? node.children : []) walk(child, id);
	};
	if (Array.isArray(parsed?.nodes)) for (const n of parsed.nodes) walk(n, null);
	const agents = Array.isArray(parsed?.agents) ? parsed.agents : [];
	return { id: "gen-1", name: "生成的工作流", nodes: flatNodes, edges: flatEdges, agents, plan: "", status: "draft" };
}

export { name, inject, apply, normalizeWorkflow, edgeIntentCandidates, edgeAllowed, dedupeReview, rollbackCascade, nextRunId, summarizeNode, downstream, topoSort, normalizeTree, PRESET_AGENTS, compileToWorkflow, reviewLanding, suggestReview, treeFromChildren, storeDir, listWorkflows, saveWorkflow, ID_PATTERN, workflowPath, autoNodeName, autoEdgeSemantics, suggestNodeConfig, VISIBLE_MENU, CATEGORY_AGENTS, heuristicGenerate, buildGeneratePrompt };
