# Code Review — dsh-workflow-studio rework (menu rail / multi-port / no-side-chat / REST)

Scope: `lib/semantics.js`, `lib/client.js`, `lib/index.js`, context `lib/tree.js`, `lib/compile.js`.
Report only — no files modified. Severity: 🔴 crash / 🟠 high / 🟡 medium / 🟢 low.

---

## Findings

### 🔴 1. Runtime crash: `err` is an undefined free variable in `GenPromptOverlay`
- **File/line:** `lib/client.js:1573`
- **Issue:** `err ? null : null` sits in the `.ws-card` children array of `GenPromptOverlay`. `err` is never declared in that scope (the only `err` state is in `AgentFormOverlay`, line 1534; the other `err`s are `catch` locals at 1089/1287). Reading an undeclared identifier throws `ReferenceError: err is not defined` **every time the "生成工作流" toolbar button is clicked** — the overlay opens, the whole `WorkflowView` render throws, and React tears down the tab view. The intended `gen.fail` / `gen.failed` error display (`locales` lines 247/386, 222/361) is never used anywhere — dead.
- **Fix:** delete the line entirely (it is a no-op anyway), and if you want inline errors, add a real `const [err, setErr] = react.useState("")` + `setErr`/`setBusy` wiring in `go()` (lines 1564–1568) and render `err ? jsx("div",{className:"ws-err",children:err}) : null`.

### 🟠 2. `edgeCounts` lags one update and is shared module state — multi-port routing breaks (multi-session + rapid reconnect)
- **File/line:** `lib/client.js:701, 722–727, 818–822` (also read at `729–737`)
- **Issue:** counts are written to the module variable `edgeCounts` inside a `useEffect` (`[edges]`) that never triggers a re-render. Handles render during the render pass with the **previous** frame's counts:
  - After edge #1, the node still shows only `out-0`; the user's next drag grabs `out-0` again, so edges #1 and #2 share one handle — the "many distinct output handles" requirement degrades in exactly the rapid-connection case. The new spare only appears after some unrelated state change.
  - `edgeCounts`, `agentRegistry`, `viewT`, and the six module-level handlers (`attachHandler`, `deleteNodeHandler`, …) are shared across **every mounted `WorkflowView`** (one per DSH session). Session B's effect rebuilds `edgeCounts` from B's edges only, so session A's nodes render a single handle; A's restored edges referencing `in-1`/`out-2` point at handles that no longer render — React Flow drops/visually breaks those connections. A's delete button also invokes B's handler.
- **Fix:** derive counts during render with `useMemo(() => {…}, [edges])` inside each `WorkflowView` and pass the map into node `data` (or a context), never a module global; drop the `useEffect` at 818–822. Same for the registry/handlers if multi-session matters.

### 🟠 3. `...tree` spread clobbers `id`/`name` on `POST /v1/flows` — every id-less flow overwrites `tree-1.json`
- **File/line:** `lib/index.js:352`
- **Issue:** `saveWorkflow(resolveDshHome(), { id: b.id || "flow-" + Date.now().toString(36), name: b.name || tree.name || "外部创建工作流", ...tree })` — the trailing `...tree` spread overrides the explicit `id`/`name` with `normalizeTree`'s defaults (`"tree-1"` / `"工作流"`, `tree.js:98–99`). The `flow-<ts>` fallback is dead code; two external callers who POST `{tree:{…}}` without an id silently overwrite the same `tree-1.json` (data loss). The same pattern appears in the client `save()` at `lib/client.js:1294` (`{ id: "default", ...tree }` → always saves as `tree-1.json`).
- **Fix:** spread first, then override: `{ ...tree, id: <b.id || tree.id || "flow-"+…>, name: <b.name || tree.name || …> }` in both places.

### 🟠 4. `v1/flows/generate` hardcodes provider `"spawn"`; a missing provider turns into a 500 instead of the heuristic fallback
- **File/line:** `lib/index.js:384–394`
- **Issue:** `subagents.start("spawn", …)` — unlike the in-app `/generate` (lines 482–483, which does `subagents.list()` provider discovery), the public endpoint assumes `"spawn"` exists. If the registry lacks it, `start()` throws, the outer `catch` (399–401) returns 500 `"internal"`, and `heuristicGenerate` (the whole point of the fallback) never runs. External callers get a useless 500.
- **Fix:** mirror `/generate`'s discovery (`const providers = subagents.list ? subagents.list() : []; const providerName = providers.includes("spawn") ? "spawn" : (providers[0] || "spawn");`) or wrap the subagent path in its own try/catch that falls through to `heuristicGenerate`.

### 🟡 5. `nodeTypes` recreated every render — every node re-renders on every state change
- **File/line:** `lib/client.js:1318`
- **Issue:** `const nodeTypes = { workflow: (p) => jsx(WorkflowNode, …) }` is rebuilt inside `WorkflowView` on each render. React Flow treats nodeTypes as changed (it also logs the "new nodeTypes object" warning), so drag/select/edge edits re-render **all** nodes. This is the dominant canvas cost once a workflow grows.
- **Fix:** hoist `const nodeTypes = { workflow: (p) => jsx(WorkflowNode, { data: p.data, selected: p.selected }) }` to module scope (WorkflowNode already reads registry/counts via module refs, so nothing else is needed).

### 🟡 6. `/run` awaits `run.dispose()` outside a guard — a dispose failure 500s a successful run
- **File/line:** `lib/index.js:270–271`
- **Issue:** `await run.dispose()` runs inside the main try; if dispose rejects, the catch sends `500 {"error":"internal"}` although the workflow already executed (client shows "运行失败" and falls back to simulation). Compare `v1/flows/generate` (line 386), which wraps dispose in try/catch correctly.
- **Fix:** wrap: `try { await run.dispose(); } catch {}` — and optionally add a timeout on `run.result` (currently no cap; a stuck engine holds the HTTP handler open indefinitely — applies to lines 270 and 386/493).

### 🟡 7. `v1/flows` POST reports 201 even when compilation failed
- **File/line:** `lib/index.js:354–356`
- **Issue:** `compiled:false, compileError:"internal"` is returned with 201. A caller cannot distinguish "created fine" from "created but not runnable"; the generic `publicError` also hides the real compile error, making it unrecoverable.
- **Fix:** return 201 with the real (sanitized) message, or 422 when `!compiled` while still persisting; at minimum surface a non-"internal" reason (e.g. schema-validation style message).

### 🟢 8. Client/host semantic mirror drift (no functional divergence today)
- **File/line:** `lib/client.js:561–589` vs `lib/semantics.js:45–127`
- **Issue:**
  - Client `autoNameNode` returns `{ title }` only; host `autoNodeName` also builds `purpose`. `addNodeFor` then sets `data.purpose = agent.role` (`client.js:1172`) — i.e. the real semantic purpose sentence is never produced client-side; host `/semantic` returns it. `purpose` is never displayed, so it is dead weight, but it is drift.
  - Text drift: loop-gate `detail` — client `"…评分；低于阈值时循环体再次迭代。"` vs host `"…的产出评分；低于放行阈值时…"`; `upstream` is filtered via `.filter(Boolean)` host-side (`semantics.js:48`) but not client-side (`client.js:564`) — the client passes only `[lastTitle]` so it can't blow up today, but `short(undefined)` handling differs.
  - Host `/semantic` default agent for `root` is `agent.executor` (`semantics.js:135`) while client `DEFAULT_AGENT.root` is `agent.planner` (`client.js:532`) — inconsistent answers between client naming and the public endpoint.
- **Fix:** if the public `/semantic` endpoint is a contract, either derive both from one source or fix the two default-agent tables and the purpose field.

### 🟢 9. `addNodeFor` auto-names from the last array node, not a real neighbor
- **File/line:** `lib/client.js:1163–1164`
- **Issue:** `const up = nodes.length ? [nodes[nodes.length - 1].data.title] : []` — the "upstream" used for `规划「X」/执行「X」/审核「X」` is whatever node happens to be last in array order, even if it has no edge to the new node. Dropping a review node onto an empty canvas with one unrelated node produces `审核「<unrelated>」`, which claims a dependency that does not exist.
- **Fix:** use the node nearest to the drop point, or the node the user last selected/connected, or leave the generic title (`审核`) when there is no real incoming edge.

### 🟢 10. Drawer defaults: guaranteed today, but fragile; legacy customs invisible
- **File/line:** `lib/client.js:1342–1343` (+ `555–556`, `531–543`)
- **Issue:** `drawerAgents` = `CATEGORY_DEFAULT_AGENTS[openCat].map(id => agentRegistry[id]).filter(Boolean)` + customs matching `a.category === openCat`. Defaults are present only because `presetAgents` (local copy) and the server `/agents` response both contain all five presets; the `.filter(Boolean)` silently swallows any preset the server stops returning. Custom agents without a `category` (legacy snapshots) never appear in any drawer. Category filter itself is correct (`=== openCat`) and the dup-id check in `AgentFormOverlay` (line 1538) prevents preset collisions.
- **Fix:** assert presence: `if (missing.length) console.warn`/fall back to local copy when the fetch response lacks a referenced preset; normalize legacy customs to a default category on restore.

### 🟢 11. localStorage v2: mount-time save can transiently clobber the snapshot
- **File/line:** `lib/client.js:853–866`
- **Issue:** the restore effect and the save effect are both mounted on first render; effects run in order, so the save effect writes the **empty** initial state (`{nodes:[],edges:[],plan:"",customAgents:[]}`) before restore's batched `setState` applies. A hard refresh inside that window loses the snapshot. It self-corrects on the next render, so impact is low.
- **Fix:** skip the first save (`useRef(true)` guard) or write inside the restore callback; also validate `customAgents` shape on restore.

### 🟢 12. Dead code / stale copy (no crash)
- **File/line:** `lib/client.js:590` (`intentLabelOf` unused), `649` (`guessKind` unused), `1179` (`addNode` unused — only `addNodeFor` is called), `104–108` (`.ws-palette`/`.ws-palItem` CSS for the removed palette), locale keys `chat.grow`/`chat.clear`/`chat.user`/`chat.assistant`/`chat.generated`/`chat.appended`/`chat.failed`, and `canvas.empty` copy ("在左侧对话中描述需求生成，或从面板手动添加节点") referencing the removed side chat.
- **Fix:** delete or reword; especially `canvas.empty` should mention the 生成工作流 toolbar modal + menu rail.

### 🟢 13. Handle overflow styling
- **File/line:** `lib/client.js:729–737`
- **Issue:** handles are placed at `top: 18 + i * 16` with no cap; a node with many edges grows handles beyond the node box (max-width 250px) and they overlap the delete button / content. Cosmetic.
- **Fix:** cap visible ports (e.g. 6) or auto-grow node height / wrap.

---

## Answers to the 9 verification points

1. **Multi-port handles** — Handles render correctly from `edgeCounts` (`client.js:722–737`), keys `in-i`/`out-i` are stable, and `Math.max(1, n+1)` keeps a spare. Bug: counts lag one frame and are shared module state → rapid second connection reuses `out-0`; cross-session views clobber each other (finding 2). Node re-render cost comes from `nodeTypes` recreation (finding 5).
2. **onConnect routing** — `sourceHandle`/`targetHandle` are recorded (`client.js:1191`); with the count lag, a new edge lands on the previous frame's spare handle, which exists, so no dangling edge — but two edges can share one handle (finding 2). Nodes that already have edges connect fine; the async review-landing path (`1200–1225`) creates the edge after two fetches — no guard against the view unmounting mid-flight (React 18 no-op). No dedupe of parallel source→target edges (allowed by design).
3. **Menu rail + drawer** — `MENU_CATEGORIES` has exactly the 4 mandated keys with 4 distinct CSS treatments (`client.js:546–551`, `css 74–85`); `drawerAgents` filter is correct and defaults are present today (all 5 presets in both local and server registry) — fragility noted in finding 10.
4. **addNodeFor defaults** — `CATEGORY_AGENT_DEFAULT`/`CATEGORY_DEFAULT_AGENTS` match `semantics.js:15–20` per category (plan→planner, action→executor, review→reviewer, loop→executor); `addNodeFor` falls back to `DEFAULT_AGENT[kind]` for root/summary/dimension. Auto-name uses the wrong "upstream" (finding 9).
5. **GenPromptOverlay** — calls `generateFromPrompt` → `POST /generate` with `sessionId`, falls back to `buildGeneratedTree` on `!ok`/throw, sets nodes/edges/plan. **Crash:** opening the modal throws `ReferenceError` on `err` (finding 1). Overlay is closed before the fetch (`setOverlay(null)` at 1142), so no loading state inside the modal — acceptable per design.
6. **AgentFormOverlay category** — `category` stored on the agent (`client.js:1539`), flows through `addCustomAgent` → `customAgents` → drawer filter `a.category === openCat` (1343) → localStorage effect (`864–866`) and restore (`853–863`). Verified end-to-end; only legacy customs (no category) are hidden (finding 10).
7. **Leftover references** — No runtime references to `generate`/`grow`/`clearChat`/`chatText`/`agentsOpen`/`paletteItems` as functions/variables; matches are locale strings, the intended `/generate` endpoint, and dead CSS/keys (finding 12). Nothing throws from leftovers.
8. **REST endpoints** — `v1/flows` GET 200 / POST 201 with compile readiness; `v1/flows/generate` 400 (no prompt) / 200 (subagent, else heuristic) / 502 (nothing generated) / 500 (internal); `v1/menu` GET 200. Error objects never leak internals (`publicError`). No deadlocks (all async; no sync waits) — but no timeout on `run.result` (finding 6). Bugs: id/name clobber (finding 3), hardcoded `"spawn"` provider (finding 4), 201-on-compile-failure (finding 7).
9. **Semantics drift** — Auto-name results are identical for titles; drift is limited to the missing client-side `purpose`, two trivial `detail` strings, `upstream` filtering, and the `root` default agent (planner vs executor) between client and `/semantic` (finding 8). No functional naming divergence in the canvas path.

**Runtime crash risk:** finding 1 is a guaranteed crash on the "生成工作流" modal. Findings 2–4 are correctness/data-loss risks, not crashes.
