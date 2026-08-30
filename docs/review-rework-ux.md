# DSH Workflow Studio — UI/UX Audit (rework review)

**Scope:** `lib/client.js` (web client, 1646 lines) + `lib/semantics.js` (auto-naming semantics). Static code review, no runtime screenshots.
**Verdict:** Strong bones (distinct 4-button rail, honest simulation mode, real edge labels, gated motion) but several product-grade gaps: the "smart auto-naming" is only half-wired, the drawer is mouse-only, 3/4 rail buttons fail contrast, and generation silently replaces the canvas. Fix the High items and it stops feeling like a prototype.

---

## Already product-grade (keep)

- Four rail buttons are genuinely distinct: color (lavender/red/amber/cyan), shape (rounded-square / teardrop / kidney-blob / circle) and icon (list / rocket / magnifier / refresh) all differ — not a renamed clone.
- Edge labels **do render** on canvas: every `mkEdge` sets `label`, and `.react-flow__edge-text` / `.react-flow__edge-textbg` are styled (line 164-165) with a readable filled background.
- Reduced-motion is handled properly: CSS `@media (prefers-reduced-motion:reduce)` kills card pop, transitions, edge flow, ring; GSAP `playNodeIn` has its own `prefersReducedMotion()` guard.
- GSAP node pop-in (`back.out(1.5)`, 0.45s) and the CSS `ws-pop` modal spring are the right Apple-ish vocabulary.
- Simulation mode is honest: clear `ws-simBadge` instead of fake "success", with deterministic per-kind summaries and per-branch file bubbles.
- LocalStorage full-fidelity snapshot + export/import + node rollback + per-edge intent editing are solid pro features.
- `onConnect` semantic inference with a server-side `review-landing`/`review-suggest` enhancement for review→X edges is genuinely smart.
- Spare-handle pattern (always ≥1 input + 1 output) gives an unconnected node an obvious "connect me" affordance.

---

## Findings (priority-ordered)

**1. [High][Q1 Q4] Agent drawer cards are mouse-only — keyboard users cannot add nodes.**
- *Observation:* Cards are `<div draggable>` with `onDragStart` + `onDoubleClick` only: no `tabIndex`, no `role`, no Enter/Space handler. Keyboard users have zero path from drawer → canvas (the only alternative is the generation modal). Delete `×` is `display:none` until hover/selected, so it is unfocusable until selection.
- *Improvement:* Make each card a real focusable element (button-like div with `tabIndex=0`, `role="button"`, `aria-grabbed`, Enter/Space adds node at a sensible auto position, arrow-keys + Enter to drop); always show a persistent, focusable delete control on custom cards (not hover-only).

**2. [High][Q4] 3 of 4 rail buttons fail WCAG AA text contrast at 10px.**
- *Observation:* White text on light ends of gradients: plan `#A78BFA` ≈ 2.7:1, action `#FB7185` ≈ 2.7:1, loop `#22D3EE` ≈ 1.8:1 (all vs 4.5:1 needed at 10px bold). Only review (dark `#3a2b00` on amber) passes ≈ 8:1. These are the product's identity buttons.
- *Improvement:* Darken gradient light-ends (or use dark text on the light half): e.g. plan `#7C3AED→#6D28D9`, action `#EF4444→#DC2626`, loop `#0891B2→#0E7490` with white text; verify with a contrast tool at 10px.

**3. [High][Q6] Generation silently REPLACES the whole canvas — no append, no confirm, no progress.**
- *Observation:* `generateFromPrompt` calls `setOverlay(null)` first, then unconditionally `setNodes(built.nodes)`. Existing work is wiped with no warning; the modal closes instantly so the `busy` state never shows (spinner is dead code); a failed API call silently falls back to the local heuristic parser with no badge telling the user they got the template tree, not the LLM.
- *Improvement:* Keep the modal open with an inline spinner until the result lands; offer "替换画布 / 追加到现有画布" when nodes exist; surface a "已使用本地解析（引擎不可用）" notice on heuristic fallback.

**4. [High][Q3] Auto-naming is only half-wired — the "smart" essence is under-delivered.**
- *Observation:* (a) `data.purpose` is set to `agent.role` (client.js:1172) and never rendered; `semantics.js` `buildPurpose()`'s rich sentence ("执行：接收「X」…") is dead code in the client. (b) Drop-time naming uses `nodes[nodes.length-1].title` (array order), not the node's actual graph position — in a free graph that reads as arbitrary. (c) Connecting an edge never renames/updates the node or announces anything: the locale keys `sem.nodeNamed` / `sem.edge` ("已按语义自动命名…"/"连线作用：…") are defined but never shown. (d) Labels nest quotes: 产出→「执行「调研员」」.
- *Improvement:* Render the purpose sentence on the node (sub-line or tooltip); compute the name from the node the user actually drags toward/from (or re-derive on first connect); show a transient toast on drop/connect announcing the generated name + edge role; sanitize label text (replace inner 「」 with '') before quoting.

**5. [High][Q6] Stale copy contradicts the current product — leftover side-chat and tree framing.**
- *Observation:* Empty state still says "画布为空 —— 在左侧对话中描述需求生成" (the side chat was removed); subtitle is "树形工作流 · 分支并行" but the vision is a free graph with negative loops; `pal.*` locale + `.ws-palette` CSS are dead; `chat.grow` ("追加节点") is defined but there is no append path.
- *Improvement:* Rewrite copy to "拖拽左侧 Agent 到画布，或点「生成工作流」"; subtitle → "自由画布 · 分支并行 · 负反馈循环"; delete dead palette CSS/locales; wire `chat.grow` into the gen modal (append mode).

**6. [High][Q4] Overlays have no dialog semantics.**
- *Observation:* All four modals are plain divs: no `role="dialog"`/`aria-modal`, no focus trap, no Escape handler, focus never moved in; only backdrop click cancels. `GenPromptOverlay` line `err ? null : null` is dead code.
- *Improvement:* Add `role="dialog" aria-modal="true"`, focus first field on open, trap Tab, close on Escape, restore focus on close.

**7. [Med][Q2] Multi-port affordance is underspecified.**
- *Observation:* In/out is signaled only by color (blue=in, green=out) + two exotic Unicode glyphs (`⤙`/`⤚` U+2939/293A — missing-glyph tofu risk in many fonts), 9px at 70% opacity, no tooltip, no port numbering. Handles are 11px (< 24px touch target). With ≥5 handles (`top:18+i*16`) they overflow short nodes and float outside the card. Handle ids are positional (`in-0..`), so when a connection is deleted the trailing spare handle disappears and its id can orphan on the stored edge.
- *Improvement:* Add per-port labels or numbering, a hover tooltip ("输入 · 接收上游产出"), swap the glyphs for reliable inline SVG arrows, bump handle size (≥20px hit area), clamp handle spacing to node height, and re-validate edge `sourceHandle`/`targetHandle` when counts change.

**8. [Med][Q1 Q2] Drop placement ignores React Flow pan/zoom.**
- *Observation:* `onDrop` computes `e.clientX - rect.left - 60` manually; with `fitView` zoom/pan transforms the node lands off-target (or outside view). React Flow provides `screenToFlowPosition` for exactly this.
- *Improvement:* Use `rf.screenToFlowPosition({x: e.clientX, y: e.clientY})` and drop there.

**9. [Med][Q4] Focus-visible coverage is inconsistent.**
- *Observation:* The focus-visible list covers `.ws-btn, .ws-input, .ws-modeSel, .ws-nodeDel, .ws-agentDel…` but not `.ws-menuBtn` (the four identity buttons), `.ws-addAgent`, `.ws-fileBtn`, `.ws-rollback` — those fall back to the browser default ring, so the custom accent ring appears/disappears across controls.
- *Improvement:* Add every interactive element to the `:focus-visible` rule (or a shared token), and give rail buttons `aria-expanded` + `aria-controls` (they toggle a drawer), and wrap the rail in `<nav aria-label>`.

**10. [Med][Q5] Motion language is mixed and one loop never stops.**
- *Observation:* GSAP for node pop-in, CSS spring for modal, but drawer open/close, run-error toast, and bubbles appear with no animation. `flowEdge` adds `.ws-edgeFlow` on every connect and never removes it — idle edges animate forever, so a finished graph keeps "flowing" alongside the run-time `ws-edgeActive` red flow.
- *Improvement:* Add a 200–250ms ease-out slide for the drawer (gated by reduced-motion); drop `ws-edgeFlow` after ~1s (or only animate while running/hovered); keep bubbles/toast subtle (opacity/fade) so motion has one vocabulary.

**11. [Med][Q6] Generation is a single-shot template — no iteration path.**
- *Observation:* The modal always emits root→plan→N actions→review→summary (loop only if a keyword matches); the result replaces the canvas; there is no "modify/extend the generated graph" step in the UI despite `chat.grow`/`chat.appended` locales.
- *Improvement:* Add an "追加/修改" mode that sends the existing tree + delta instruction to the host and merges the diff into the current canvas; add 2–3 example chips in the modal to teach the feature.

**12. [Med][Q6] The hero action is misplaced: generation is visually secondary.**
- *Observation:* "生成工作流" is a plain `.ws-btn` in the runbar while the primary (filled) button is "运行". For a product whose essence is AI auto-construction, generation should be the primary.
- *Improvement:* Make "生成工作流" the `primary` button and "运行" secondary-but-bold; or split: primary generation, with run clearly available.

**13. [Med][Q1] Drawer expansion affordance is weak.**
- *Observation:* The only open-state cues are a small `::after` caret + colored ring; the drawer pops in with no motion, and the four organic radii (especially review's `50% 6px 50% 6px` kidney) can read as a rendering bug at a glance.
- *Improvement:* Animate the drawer in (see #10); consider simplifying the review shape to a consistent asymmetric round (e.g. `50% 50% 12px 12px` variants) so shapes read as intentional.

**14. [Med][Q2 Q3] No feedback loop announcing auto-naming results.**
- *Observation:* Name/label changes just appear. There is no confirmation that the system "understood" the connection (which is the product's 自主性 essence) — the user can't tell the difference between auto-generated semantics and default behavior.
- *Improvement:* Toast on drop/connect with the generated name + edge role ("连线作用：审核「X」评分闸门"), dismissible and short-lived; also show the full `detail` sentence in the edge edit modal (currently only `label` is editable/visible, `detail` is stored but never shown).

**15. [Low][Q3] Edge label fallback can show raw intent keys.**
- *Observation:* `treeToRF` uses `label: e.data?.detail || e.intent || "context"` — legacy/host trees without `detail` render the raw key ("artifact", "loop-gate") instead of a localized label.
- *Improvement:* Fall back through `intentLabel(intent)` before raw key, matching the import path.

**16. [Low][Q1] Loop category roster duplicates Action.**
- *Observation:* Both Action and Loop drawers list only `agent.executor` — conceptually distinct categories with identical content; the loop button promises iteration but offers no loop-specialized agent.
- *Improvement:* Ship a loop-specific default (e.g. a "收敛器/评分员" agent) or show loop-capable presets with a mode badge.

**17. [Low][Q6] Keyboard shortcut is undocumented.**
- *Observation:* Cmd/Ctrl+Enter submits the gen modal but no helper text mentions it; and the primary visible affordance is only the Confirm button.
- *Improvement:* Add a muted "⌘⏎ 生成" hint in the modal footer.

**18. [Low][Q1 Q2] Small polish nits.**
- *Observation:* `ws-handle` hover only changes color (no grow/scale); file rows and out-rows use `title` for full paths (no visible copy affordance); `.ws-agentPrompt` truncates at 150px with no way to read the full prompt except editing.
- *Improvement:* Scale handle on hover (reduced-motion gated), add a visible "复制路径" chip on file rows, and let prompt text expand on hover/focus.

---

## Top 5 to fix first

1. Keyboard access to the drawer (card focus + Enter to drop) — #1
2. Contrast pass on the three failing rail gradients — #2
3. Generation: keep modal open with spinner, confirm before replacing, badge the heuristic fallback — #3
4. Wire the full purpose sentence + connect-toast so auto-naming *feels* smart — #4
5. Purge stale side-chat/tree copy and dead palette code — #5
