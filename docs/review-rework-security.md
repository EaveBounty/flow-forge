# Security Audit — dsh-workflow-studio v0.3.0 (rework / new code)

Date: audit of the new code added for v0.3.0.
Scope: `lib/semantics.js`, `lib/index.js` (host REST endpoints `/api/dsh-workflow-studio/semantic`, `/v1/flows`, `/v1/flows/generate`, `/v1/menu`; `buildGeneratePrompt`, `heuristicGenerate`), `lib/client.js` (menu rail, agent drawer, multi-port nodes, auto-naming), `package.json`. Supporting code read for context: `lib/compile.js`, `lib/workflow.js`, `lib/tree.js`.

Threat model: the `/api/dsh-workflow-studio/v1/*` REST API is intended for external friends/clients and is treated as **potentially unauthenticated**.

---

## Findings

### 1. Injection into the native `script` compiler — SAFE

- `jsStr()` = `JSON.stringify(String(s))` (`lib/compile.js:13-15`) is used for **every** user/LLM string embedded in the generated script: node titles/prompts, `$plan`, `$res[...]` keys, edge-inject text, agent `label`/`phase` (`lib/compile.js:18-43, 118, 171-185`). Everything is emitted as a double-quoted JS string literal; quotes/backticks/`${}` cannot break out.
- Identifiers go through `varName()` → `v` + `[A-Za-z0-9_]`-sanitized id (`lib/compile.js:250-253`), never raw.
- `buildGeneratePrompt` (`lib/index.js:522-542`) only feeds an LLM (no code path); `v1/flows` compiles but never executes (`lib/index.js:355`); execution (`/run`, `lib/index.js:262-269`) requires a live session. No raw template-literal interpolation of user text exists anywhere in the codegen path.
- No fix needed.

### 2. Medium — Unbounded loop count via numeric injection

- `lib/compile.js:139-140` and `208-209`: `Number(node.loop?.maxAttempts) || 3` and `Number(node.loop?.threshold) || 0.7`.
- `Number("Infinity")` / `Number("1e309")` → `Infinity`, which is truthy, so the default clamp never applies.
- A loop node without gate edges compiles to `do { … } while (0 < threshold && attempts < Infinity)` (`lib/compile.js:164-173`) → **infinite subagent loop** when the flow is run.
- Reachability: trees are attacker-persistable via `POST /v1/flows` (`lib/index.js:352`), then executed via `POST /run` (`lib/index.js:262-269`) or later by a user in the GUI.
- Fix: clamp inputs, e.g.
  ```js
  const m = Number(node.loop?.maxAttempts);
  const maxAttempts = Number.isFinite(m) ? Math.min(Math.max(1, Math.floor(m)), 100) : 3;
  const t = Number(node.loop?.threshold);
  const threshold = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0.7;
  ```

### 3. Path traversal / unsafe `id` handling — SAFE

- `workflowPath` (`lib/index.js:61-66`) enforces `ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/` (`lib/index.js:44`) — `.`, `/`, `\` are all excluded — then `resolve(dir, id + ".json")` plus a containment check (`file.startsWith(dir + sep)`).
- Bad id → `BAD_ID` → 400 (`lib/index.js:170-171, 361`).
- `POST /v1/flows` passes arbitrary `b.id` through `normalizeWorkflow` (`lib/workflow.js:50`) then `saveWorkflow` → `workflowPath`. Both `b.id` and a `tree.id` supplied inside the spec are validated; no traversal is possible.
- Nit (non-security): the `...tree` spread at `lib/index.js:352` means a `tree.id` inside the spec silently **overrides** `b.id` — the documented `b.id` field is ignored when the tree carries its own id. Functionally confusing; reorder to `{ ...tree, id: b.id || … }` if `b.id` should win.

### 4. Medium — DoS: no auth, no rate limit, LLM spawn per request

- `lib/index.js:43` (4 MB `readBody` cap) and `88-117` are good, but they are the **only** bound.
- (a) `POST /v1/flows` (`lib/index.js:335-366`) is O(n·m) (`lib/compile.js:197-201` filters edges per id) with an **uncapped node count**; a 4 MB body of ~100k tiny nodes burns seconds of CPU per request (normalize + compile + 2-space `JSON.stringify` + disk write).
- (b) Repeated POSTs with unique valid ids grow the store with **no quota / eviction** → disk fill, and `listWorkflows` (`lib/index.js:54-58`) degrades as the store grows.
- (c) `POST /v1/flows/generate` (`lib/index.js:368-404`) and `POST /generate` (`lib/index.js:464-514`) spawn **real LLM subagents per request** whenever `sessionId` matches a live agent — no auth, no rate limit → token burn / cost DoS (session id is the only gate, and ids may be guessable).
- Fix: per-IP rate limiting; cap nodes/edges (e.g., 500) at the v1 boundary; store quota + eviction; require an API token for v1 writes and for all generate/run calls.

### 5. Low — Info disclosure on unauthenticated reads

- `publicError` (`lib/index.js:84-86`) is clean — **no absolute paths or stack traces leak**; all 500s go through it and the 400/405/413 bodies are static strings. Good.
- However, `GET /v1/flows` (`lib/index.js:341-343`) and `GET /workflow` (`lib/index.js:157-159`) return **all persisted workflows** to any caller — including node `prompt`s and `plan` text, which may be sensitive. `GET /v1/menu` (`lib/index.js:413`) exposes preset agent prompts (static, minor).
- Fix: redact `prompt`/`plan` in list responses, or require auth for reads; document that the store contains sensitive data.

### 6. `heuristicGenerate` — SAFE

- `lib/index.js:549-580`: regexes at 551-554 are anchored, single-quantifier, no nested quantifiers → **no ReDoS**.
- Steps are capped (`slice(0, 6)`), fallback `slice(0, 60)`; memory bounded by the 4 MB body cap; titles reach code only via `JSON.stringify`.
- No fix needed.

### 7. Low — CSRF / method handling

- Method routing is **correct** on all endpoints: GET/HEAD read-only, POST for writes, 405 otherwise, **no state-changing GET**.
- Gap: no Origin/Host check and no CSRF token. A cross-site HTML form (`application/x-www-form-urlencoded` is CORS-safelisted → no preflight) POSTing `/api/dsh-workflow-studio/workflow` yields body `{}` (JSON.parse fails) → `normalizeWorkflow({})` → **silently overwrites `start-1.json`** with the empty base workflow (`lib/index.js:161-166`, `68-76`) — unauthenticated single-file data destruction against a localhost-bound server.
- JSON-body `/v1/*` writes are preflight-blocked cross-origin (no ACAO headers), so they are not browser-CSRF-reachable.
- Fix: reject non-`application/json` content-types; add an Origin / Sec-Fetch-Site allowlist + CSRF token for same-origin endpoints.

### 8. Client bundle XSS — SAFE

- Full-file grep of `lib/client.js`: **no** `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, or `new Function`.
- All user text (node titles, edge labels `lib/client.js:608-611`, review items `774-776`, bubbles `786-789`, `runInfo.error` `1408`) renders as React text children → auto-escaped.
- `querySelector` interpolations (`lib/client.js:892`, `1194`) only ever receive `uid()`-generated ids (safe alphabet), so no selector injection.
- Imported/localStorage JSON (`lib/client.js:855-866`, `1249-1290`) flows into React state → escaped.
- Nit: CDN UMD script + stylesheet injected **without SRI** (`lib/client.js:499-515`) — versions are pinned, but a CDN compromise/MITM executes JS in the DSH web origin. Fix: add SRI integrity hashes or self-host the UMD bundles.

### 9. Low/Medium — Prompt injection into the generator subagent

- `lib/index.js:522-542`: raw `prompt` is interpolated into `buildGeneratePrompt`'s LLM instructions. Impact is confined to LLM output (`treeFromChildren` `lib/index.js:583-600` maps only known fields → no code path).
- Combined with finding 4c it is primarily an **unauthenticated LLM-spawn / cost vector** (guessable session ids + no rate limit).
- Fix: as 4c — token + rate limit on generate.

---

## Nits

- The 413 is sent after `req.destroy()` (`lib/index.js:101-104`), so the response may never be delivered to the client; respond with 413 first (or write the response before destroying the socket).
- `json()` (`lib/index.js:78-81`) omits `X-Content-Type-Options: nosniff` (minor; content-type is always JSON).
- HEAD requests return full response bodies (harmless; clients ignore them).

---

## Bottom line

No code-execution or path-traversal hole found in the new code. The material items are:

1. the unauthenticated + unthrottled REST surface and per-request LLM subagent spawn (findings 4, 9),
2. the `Infinity` loop-count allowing an infinite compiled loop (finding 2),
3. the form-CSRF single-file workflow overwrite (finding 7).

Findings 1, 3, 6, 8 are safe as written; 5 is a disclosure-by-design concern for the unauthenticated list endpoints.
