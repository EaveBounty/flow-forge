const dshWorkflowStudioFactory = (require) => {
		// @dsh-local/dsh-workflow-studio — web client (hand-validated JSX bundle, no build step).
		// Registers a `workflow` tab in conversation.view and renders the free-graph editor:
		//   - LEFT = a MENU RAIL with exactly four visually-distinct buttons (plan/action/review/
		//     loop). Clicking a button opens a drawer listing that category's AGENTS (the default
		//     presets + any user-custom agents); each agent card is draggable onto the canvas to
		//     spawn a node, and a "+ Custom" button adds a user-defined agent for that category.
		//   - RIGHT = tree canvas (React Flow). Every node has MULTIPLE input handles (left) and
		//     MULTIPLE output handles (right) — each side accepts many connections.
		//   - Semantic auto-naming: dropped nodes and connected edges get an auto-generated title
		//     / purpose based on kind + neighbors (lib/semantics.js mirror kept self-contained).
		//   - No side chat: the DeepSeek bottom dialog is always present, so generation is a
		//     compact "生成工作流" prompt modal in the toolbar (+ the REST API for external calls).
		//   - Run: POST /run with the compiled tree; backfill value.results[nodeId] onto node
		//     bubbles and value.outputs[nodeId] onto per-branch file bubbles. When the native
		//     engine is absent ({ok:false, simulation:true}) or offline, show a clear simulation
		//     badge and still run a local staged simulation so the UX works.
		// xyflow (React Flow) and GSAP are injected as UMD globals (window.ReactFlow / window.gsap).
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		let _primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		const { jsx, jsxs, Fragment } = react_jsx_runtime;

		// Expose React (and react-dom if the loader provides it) for the injected xyflow UMD,
		// which externalizes react / react-dom / react/jsx-runtime as globals.
		let react_dom = null;
		try { react_dom = require("react-dom"); } catch (e) { react_dom = null; }
		if (typeof window !== "undefined") {
			window.React = window.React || react;
			window.jsxRuntime = window.jsxRuntime || react_jsx_runtime;
			if (react_dom && !window.ReactDOM) window.ReactDOM = react_dom;
		}

		//#region CSS tokens + styles (Apple-grade)
		const css = `
:root{
  --ws-accent:var(--dsw-alias-brand-primary,#007AFF); --ws-accent-dark:#0A84FF;
  --ws-bg:#FFFFFF; --ws-bg-2:#F2F2F7; --ws-bg-3:#E5E5EA;
  --ws-label:#000000; --ws-label-2:rgba(60,60,67,.6);
  --ws-success:#34C759; --ws-danger:#FF3B30; --ws-warning:#FF9500;
  --ws-dur-instant:100ms; --ws-dur-fast:150ms; --ws-dur-base:250ms; --ws-dur-slow:400ms; --ws-dur-expressive:550ms;
  --ws-ease-out:cubic-bezier(.16,1,.3,1); --ws-ease-in-out:cubic-bezier(.45,0,.25,1); --ws-ease-over:cubic-bezier(.34,1.56,.64,1);
  --ws-glass-blur:20px; --ws-glass-saturate:1.8; --ws-glass-bg:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.55)); --ws-glass-border:1px solid rgba(255,255,255,.25);
  --ws-glass-highlight:inset 0 1px 0 rgba(255,255,255,.15);
  --ws-shadow-card:0 2px 12px rgba(0,0,0,.08),0 8px 32px rgba(0,0,0,.12);
  --ws-shadow-float:0 16px 48px rgba(0,0,0,.20);
  --ws-r-sm:8px; --ws-r-md:12px; --ws-r-lg:16px; --ws-r-xl:24px;
}
.ws-view{position:relative;display:flex;flex-direction:column;height:100%;min-height:0;font-size:13px;color:var(--dsw-alias-label-primary,var(--ws-label));background:var(--dsw-alias-bg-base,var(--ws-bg));color-scheme:light dark}
.ws-toolbar{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l1,var(--ws-bg-3));flex:none;backdrop-filter:blur(var(--ws-glass-blur)) saturate(var(--ws-glass-saturate));background:var(--ws-glass-bg);flex-wrap:wrap}
.ws-title{font-size:14px;font-weight:600;margin:0}
.ws-sub{color:var(--dsw-alias-label-secondary,var(--ws-label-2));font-size:11px}
.ws-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l2,var(--ws-bg-3));background:var(--dsw-alias-bg-layer-1,var(--ws-bg));color:var(--dsw-alias-label-primary,var(--ws-label));border-radius:var(--ws-r-sm);padding:5px 12px;font-size:12px;cursor:pointer;transition:transform var(--ws-dur-fast) var(--ws-ease-out),background var(--ws-dur-fast) var(--ws-ease-out)}
.ws-btn:hover{background:var(--dsw-alias-interactive-bg-hover,var(--ws-bg-2));transform:scale(1.02)}
.ws-btn:active{transform:scale(.98)}
.ws-btn.primary{background:var(--ws-accent);border-color:transparent;color:var(--dsw-alias-label-primary-inverse,#fff)}
.ws-btn.primary:hover{filter:brightness(1.05)}
.ws-btn:disabled{opacity:.55;cursor:default;transform:none}
.ws-btnSm{padding:3px 8px;font-size:11px}
.ws-body{flex:1;min-height:0;position:relative;display:flex}
/* == left: category MENU RAIL (4 distinct buttons) + agent drawer == */
.ws-rail{width:76px;flex:none;display:flex;flex-direction:column;gap:10px;padding:12px 8px;border-right:1px solid var(--dsw-alias-border-l1,var(--ws-bg-3));background:var(--dsw-alias-bg-layer-0,var(--ws-bg-2));align-items:stretch;z-index:3}
.ws-railTitle{font-size:10px;font-weight:700;color:var(--dsw-alias-label-tertiary,var(--ws-label-2));text-transform:uppercase;letter-spacing:.06em;text-align:center}
/* Four DISTINCT menu buttons — not a renamed clone. */
.ws-menuBtn{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;width:100%;padding:12px 4px 10px;border:1px solid transparent;border-radius:14px;cursor:pointer;font-size:10px;font-weight:700;letter-spacing:.02em;color:#fff;transition:transform var(--ws-dur-fast) var(--ws-ease-out),filter var(--ws-dur-fast) var(--ws-ease-out),box-shadow var(--ws-dur-fast) var(--ws-ease-out);box-shadow:0 3px 10px rgba(0,0,0,.18)}
.ws-menuBtn:hover{transform:translateY(-2px);filter:brightness(1.08)}
.ws-menuBtn:active{transform:translateY(0) scale(.97)}
.ws-menuBtn .ws-mIcon{width:22px;height:22px;display:flex;align-items:center;justify-content:center}
.ws-menuBtn.open::after{content:"";position:absolute;right:-9px;top:50%;transform:translateY(-50%);width:0;height:0;border-top:6px solid transparent;border-bottom:6px solid transparent;border-left:7px solid var(--dsw-alias-bg-overlay,var(--ws-bg))}
.ws-menuBtn span{line-height:1.1}
/* Plan — lavender checklist */
.ws-menuBtn.plan{background:linear-gradient(135deg,#7C3AED,#6D28D9);border-radius:14px 4px 14px 14px}
.ws-menuBtn.plan.open{box-shadow:0 0 0 2px #A78BFA,0 8px 22px rgba(124,58,237,.4)}
/* Action — red rocket */
.ws-menuBtn.action{background:linear-gradient(135deg,#EF4444,#DC2626);border-radius:50% 50% 12px 12px}
.ws-menuBtn.action.open{box-shadow:0 0 0 2px #FB7185,0 8px 22px rgba(239,68,68,.4)}
/* Review — amber shield/eyeball */
.ws-menuBtn.review{background:linear-gradient(135deg,#F59E0B,#D97706);color:#1c1200;border-radius:50% 6px 50% 6px}
.ws-menuBtn.review.open{box-shadow:0 0 0 2px #FBBF24,0 8px 22px rgba(245,158,11,.4)}
/* Loop — cyan refresh/cycle */
.ws-menuBtn.loop{background:linear-gradient(135deg,#0891B2,#0E7490);border-radius:50% 50% 50% 50%}
.ws-menuBtn.loop.open{box-shadow:0 0 0 2px #22D3EE,0 8px 22px rgba(8,145,178,.4)}
/* drawer: agent list for the open category */
.ws-drawer{width:232px;flex:none;display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--dsw-alias-border-l1,var(--ws-bg-3));background:var(--dsw-alias-bg-layer-0,var(--ws-bg-2));z-index:3}
.ws-drawerHead{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;font-size:12px;font-weight:700;border-bottom:1px solid var(--dsw-alias-border-l1,var(--ws-bg-3));flex:none}
.ws-drawerHead .ws-cat{display:inline-flex;align-items:center;gap:6px}
.ws-agentList{flex:1;min-height:0;overflow:auto;padding:8px;display:flex;flex-direction:column;gap:6px}
.ws-agentCard{display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1,var(--ws-bg-3));border-radius:10px;background:var(--dsw-alias-bg-layer-1,var(--ws-bg));cursor:grab;font-size:11px;text-align:left;transition:box-shadow var(--ws-dur-fast) var(--ws-ease-out),transform var(--ws-dur-fast) var(--ws-ease-out)}
.ws-agentCard:hover{box-shadow:var(--ws-shadow-card);transform:translateY(-1px);border-color:var(--dsw-alias-brand-primary,var(--ws-accent))}
.ws-agentCard .ws-agentName{font-weight:700;font-size:12px}
.ws-agentCard .ws-agentRole{color:var(--dsw-alias-label-secondary,var(--ws-label-2));font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ws-agentCard .ws-agentPrompt{color:var(--dsw-alias-label-tertiary,var(--ws-label-2));font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:150px}
.ws-agentCustom{font-size:9px;color:var(--ws-accent);border:1px solid color-mix(in srgb,var(--ws-accent) 45%,transparent);border-radius:99px;padding:0 5px;flex:none}
.ws-agentDel{border:none;background:transparent;color:var(--dsw-alias-label-secondary,var(--ws-label-2));cursor:pointer;font-size:13px;line-height:1;padding:2px 4px;border-radius:50%}
.ws-agentDel:hover{color:var(--ws-danger)}
.ws-addAgent{border:1px dashed var(--dsw-alias-border-l2,var(--ws-bg-3));background:transparent;color:var(--ws-accent);border-radius:10px;padding:8px;font-size:11px;font-weight:600;cursor:pointer;text-align:center;transition:background var(--ws-dur-fast) var(--ws-ease-out)}
.ws-addAgent:hover{background:color-mix(in srgb,var(--ws-accent) 10%,transparent)}
.ws-drawerHint{font-size:10px;color:var(--dsw-alias-label-tertiary,var(--ws-label-2));padding:4px 12px 8px;line-height:1.5}
/* == canvas == */
.ws-canvas{flex:1;min-width:0;position:relative}
.ws-palette{position:absolute;top:12px;left:12px;z-index:5;width:152px;display:flex;flex-direction:column;gap:6px;padding:8px;border-radius:var(--ws-r-md);border:1px solid var(--dsw-alias-border-l1,var(--ws-bg-3));background:var(--ws-glass-bg);backdrop-filter:blur(var(--ws-glass-blur)) saturate(var(--ws-glass-saturate));box-shadow:var(--ws-shadow-card)}
.ws-palette h5{margin:0 0 2px;font-size:11px;color:var(--dsw-alias-label-secondary,var(--ws-label-2));text-transform:uppercase;letter-spacing:.04em}
.ws-palItem{display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid var(--dsw-alias-border-l1,var(--ws-bg-3));border-radius:var(--ws-r-sm);background:var(--dsw-alias-bg-layer-1,var(--ws-bg));cursor:pointer;font-size:12px;text-align:left;transition:box-shadow var(--ws-dur-fast) var(--ws-ease-out),transform var(--ws-dur-fast) var(--ws-ease-out)}
.ws-palItem:hover{box-shadow:var(--ws-shadow-card);transform:translateY(-1px)}
.ws-palItem svg{flex:none}
.ws-canvasEmpty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;color:var(--dsw-alias-label-tertiary,var(--ws-label-2));font-size:12px;text-align:center;padding:24px;z-index:1}
.ws-runError{position:absolute;bottom:16px;left:50%;transform:translateX(-50%);z-index:6;font-size:12px;color:var(--dsw-alias-label-primary-inverse,#fff);background:var(--ws-danger);border-radius:99px;padding:6px 14px;box-shadow:var(--ws-shadow-card);max-width:70%}
.ws-toast{position:absolute;bottom:16px;left:50%;transform:translateX(-50%);z-index:7;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary-inverse,#fff);background:var(--dsw-alias-brand-primary,var(--ws-accent));border-radius:99px;padding:7px 16px;box-shadow:var(--ws-shadow-float);max-width:80%;text-align:center;animation:ws-pop var(--ws-dur-base) var(--ws-ease-out)}
@media (prefers-reduced-motion:reduce){.ws-toast{animation:none}}
/* == nodes == */
.ws-node{position:relative;display:flex;flex-direction:column;gap:4px;padding:8px 12px;border-radius:var(--ws-r-md);border:1px solid var(--dsw-alias-border-l2,var(--ws-bg-3));background:var(--dsw-alias-bg-overlay,var(--ws-bg));box-shadow:var(--ws-shadow-card);font-size:12px;min-width:180px;max-width:250px;transition:transform var(--ws-dur-fast) var(--ws-ease-out),box-shadow var(--ws-dur-fast) var(--ws-ease-out)}
.ws-node:hover{box-shadow:var(--ws-shadow-float)}
.ws-node.sel{outline:2px solid var(--ws-accent);outline-offset:1px}
.ws-nodeHead{display:flex;align-items:center;gap:6px;font-weight:600;padding-right:14px}
.ws-nodeTitle{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ws-nodeSub{color:var(--dsw-alias-label-secondary,var(--ws-label-2));font-size:11px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ws-kindTag{font-size:9px;padding:1px 6px;border-radius:99px;border:1px solid currentColor;opacity:.85;flex:none;line-height:1.5}
.ws-nodeDel{position:absolute;top:-8px;right:-8px;width:18px;height:18px;border-radius:50%;border:1px solid var(--dsw-alias-border-l2,var(--ws-bg-3));background:var(--dsw-alias-bg-overlay,var(--ws-bg));color:var(--dsw-alias-label-secondary,var(--ws-label-2));cursor:pointer;font-size:13px;line-height:1;display:none;align-items:center;justify-content:center;z-index:2}
.ws-node:hover .ws-nodeDel,.ws-node.sel .ws-nodeDel{display:flex}
.ws-nodeDel:hover{color:var(--ws-danger);border-color:var(--ws-danger)}
.ws-loopMeta{display:flex;flex-wrap:wrap;gap:6px;font-size:10px;color:var(--dsw-alias-label-secondary,var(--ws-label-2))}
.ws-flagged{font-size:10px;color:var(--ws-danger);border:1px solid rgba(255,59,48,.5);border-radius:99px;padding:0 6px}
/* == loop = Scratch-style C-shape hollow container == */
.ws-node.loop-node{background:transparent;box-shadow:none;border:none;padding:0;min-width:220px}
.ws-loopFrame{position:relative;border:2.5px solid var(--dsw-alias-state-info,#0A84FF);border-radius:20px;padding:14px;min-height:96px;transition:min-height var(--ws-dur-slow) var(--ws-ease-out),box-shadow var(--ws-dur-fast) var(--ws-ease-out);background:color-mix(in srgb,var(--dsw-alias-state-info,#0A84FF) 6%,transparent)}
.ws-node.loop-node:hover .ws-loopFrame{box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-info,#0A84FF) 25%,transparent)}
/* C-shape notch: Scratch "repeat" bodies have a cut-out bottom-right mouth. */
.ws-loopFrame::after{content:"";position:absolute;right:-2.5px;bottom:26px;width:16px;height:22px;background:var(--dsw-alias-bg-overlay,var(--ws-bg));border-bottom:2.5px solid var(--dsw-alias-state-info,#0A84FF);border-right:2.5px solid var(--dsw-alias-state-info,#0A84FF);border-radius:0 0 12px 0}
.ws-loopHead{display:flex;align-items:center;gap:6px;margin-bottom:10px;font-weight:700;font-size:12px;color:var(--dsw-alias-state-info,#0A84FF)}
.ws-loopHead .ws-nodeDel{position:static;display:flex;margin-left:auto}
.ws-loopBody{display:flex;flex-direction:column;gap:6px;min-height:46px}
.ws-loopEmpty{font-size:11px;color:var(--dsw-alias-label-tertiary,var(--ws-label-2));border:1px dashed color-mix(in srgb,var(--dsw-alias-state-info,#0A84FF) 40%,transparent);border-radius:10px;padding:10px;text-align:center}
.ws-loopSub{display:flex;align-items:center;gap:6px;padding:6px 8px;border:1px solid var(--dsw-alias-border-l1,var(--ws-bg-3));border-radius:8px;background:var(--dsw-alias-bg-overlay,var(--ws-bg));font-size:11px;box-shadow:var(--ws-shadow-card);cursor:grab;animation:ws-pop var(--ws-dur-base) var(--ws-ease-out)}
.ws-loopSub:hover{border-color:var(--dsw-alias-state-info,#0A84FF)}
.ws-loopSub .ws-title{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:150px}
.ws-loopSub .ws-subDel{margin-left:auto;border:none;background:transparent;color:var(--dsw-alias-label-tertiary,var(--ws-label-2));cursor:pointer}
.ws-loopSub .ws-subDel:hover{color:var(--ws-danger)}
.ws-loopAdd{margin-top:4px;font-size:10px;color:var(--dsw-alias-state-info,#0A84FF);border:1px dashed color-mix(in srgb,var(--dsw-alias-state-info,#0A84FF) 50%,transparent);border-radius:8px;padding:4px;background:transparent;cursor:pointer;text-align:center}
.ws-loopAdd:hover{background:color-mix(in srgb,var(--dsw-alias-state-info,#0A84FF) 10%,transparent)}
.ws-handle{width:12px;height:12px;background:var(--ws-accent);border:2px solid var(--dsw-alias-bg-overlay,var(--ws-bg));border-radius:50%;transition:transform var(--ws-dur-fast) var(--ws-ease-out),box-shadow var(--ws-dur-fast) var(--ws-ease-out)}
.ws-handle:hover{transform:scale(1.25);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-info,var(--ws-accent)) 35%,transparent)}
.ws-handleIn{background:var(--dsw-alias-state-info,var(--ws-accent));border-color:color-mix(in srgb,var(--dsw-alias-state-info,var(--ws-accent)) 30%,transparent)}
.ws-handleOut{background:var(--ws-success);border-color:color-mix(in srgb,var(--ws-success) 30%,transparent)}
@media (prefers-reduced-motion:reduce){.ws-handle{transition:none}.ws-handle:hover{transform:none}}
/* == file bubbles + branch output == */
.ws-files{display:flex;flex-direction:column;gap:3px;margin-top:2px}
.ws-fileRow{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--dsw-alias-label-secondary,var(--ws-label-2));cursor:pointer;padding:3px 6px;border-radius:6px;transition:background var(--ws-dur-fast) var(--ws-ease-out)}
.ws-fileRow:hover{background:var(--dsw-alias-interactive-bg-hover,var(--ws-bg-2));color:var(--ws-accent)}
.ws-fileRow svg{flex:none}
.ws-fileBtn{font-size:10px;color:var(--ws-accent);border:1px dashed var(--dsw-alias-border-l2,var(--ws-bg-3));border-radius:6px;padding:2px 8px;background:transparent;cursor:pointer;transition:transform var(--ws-dur-fast) var(--ws-ease-out);align-self:flex-start}
.ws-fileBtn:hover{transform:scale(1.03)}
.ws-outRow{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--dsw-alias-state-success,var(--ws-success));border:1px dashed color-mix(in srgb,var(--dsw-alias-state-success,var(--ws-success)) 55%,transparent);border-radius:6px;padding:3px 6px;cursor:pointer;margin-top:2px}
.ws-outName{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:170px}
/* == review == */
.ws-reviewList{display:flex;flex-direction:column;gap:4px;margin-top:2px;max-height:120px;overflow:auto}
.ws-reviewItem{display:flex;align-items:flex-start;gap:6px;font-size:11px;padding:3px 6px;border-radius:6px;background:var(--dsw-alias-bg-layer-1,var(--ws-bg-2))}
.ws-reviewItem .ws-dim{font-weight:600;color:var(--dsw-alias-label-primary,var(--ws-label));flex:none}
.ws-reviewItem .ws-issue{color:var(--dsw-alias-label-secondary,var(--ws-label-2))}
.ws-reviewItem.pass{border-left:2px solid var(--ws-success)}
.ws-reviewItem.fail{border-left:2px solid var(--ws-danger)}
/* == runtime visualization + bubbles + rollback == */
@keyframes ws-breath{0%,100%{transform:scale(1);opacity:.55}50%{transform:scale(1.18);opacity:.95}}
.ws-ring{position:absolute;inset:-7px;border-radius:var(--ws-r-lg);border:2px solid var(--ws-danger);pointer-events:none;animation:ws-breath 1.4s ease-in-out infinite}
.ws-bubble{margin-top:6px;padding:6px 8px;border-radius:var(--ws-r-sm);background:var(--dsw-alias-bg-layer-2,var(--ws-bg-2));border:1px solid var(--dsw-alias-border-l1,var(--ws-bg-3));font-size:11px;color:var(--dsw-alias-label-secondary,var(--ws-label-2));max-width:220px;word-break:break-word}
.ws-bubble .ws-sum{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.ws-bubble .ws-detail{display:none}
.ws-bubble:hover .ws-detail{display:block;color:var(--dsw-alias-label-primary,var(--ws-label));white-space:pre-wrap}
.ws-bubble.pending{color:var(--dsw-alias-label-tertiary,var(--ws-label-2));font-style:italic}
.ws-node.bubble-float .ws-bubble{display:none}
.ws-node.bubble-float:hover .ws-bubble{display:block;position:absolute;top:100%;left:0;z-index:6;box-shadow:var(--ws-shadow-card)}
.ws-rollback{font-size:10px;color:var(--ws-warning);border:1px solid rgba(255,149,0,.5);border-radius:6px;padding:1px 7px;background:transparent;cursor:pointer;margin-top:4px;align-self:flex-start}
.ws-rollback:hover{background:rgba(255,149,0,.12)}
.ws-modeSel{font-size:10px;border:1px solid var(--dsw-alias-border-l2,var(--ws-bg-3));border-radius:6px;padding:1px 4px;background:var(--dsw-alias-bg-layer-1,var(--ws-bg));color:var(--dsw-alias-label-secondary,var(--ws-label-2));max-width:64px}
.ws-agentSel{max-width:110px}
.ws-status{font-size:11px;color:var(--dsw-alias-label-secondary,var(--ws-label-2))}
@keyframes ws-edge-flow{to{stroke-dashoffset:-24}}
.ws-edgeFlow{stroke-dasharray:6 6;animation:ws-edge-flow 1s linear infinite}
.ws-edgeActive path{stroke:var(--ws-danger)!important;stroke-dasharray:6 6;animation:ws-edge-flow 1s linear infinite}
.react-flow__edge-text{font-size:10px;font-weight:600;fill:var(--dsw-alias-label-primary,var(--ws-label))}
.react-flow__edge-textbg{fill:var(--dsw-alias-bg-overlay,var(--ws-bg));stroke:var(--dsw-alias-border-l2,var(--ws-bg-3));stroke-width:1}
.ws-runbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.ws-simBadge{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;color:var(--dsw-alias-state-warning,var(--ws-warning));border:1px solid color-mix(in srgb,var(--dsw-alias-state-warning,var(--ws-warning)) 55%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-warning,var(--ws-warning)) 14%,transparent);border-radius:99px;padding:2px 10px}
/* == overlays == */
.ws-overlay{position:fixed;inset:0;z-index:1300;background:rgba(0,0,0,.38);display:flex;align-items:center;justify-content:center}
.ws-card{width:min(420px,calc(100vw - 32px));max-height:calc(100vh - 48px);overflow:auto;border-radius:var(--ws-r-lg);background:var(--dsw-alias-bg-overlay,var(--ws-bg));color:var(--dsw-alias-label-primary,var(--ws-label));box-shadow:var(--ws-shadow-float);padding:16px;display:flex;flex-direction:column;gap:10px;animation:ws-pop var(--ws-dur-slow) var(--ws-ease-over)}
@keyframes ws-pop{from{opacity:0;transform:translateY(10px) scale(.97)}to{opacity:1;transform:none}}
.ws-card h4{margin:0;font-size:14px}
.ws-field{display:flex;flex-direction:column;gap:4px}
.ws-field label{font-size:11px;color:var(--dsw-alias-label-secondary,var(--ws-label-2))}
.ws-input{width:100%;box-sizing:border-box;background:var(--dsw-alias-bg-layer-1,var(--ws-bg));color:var(--dsw-alias-label-primary,var(--ws-label));border:1px solid var(--dsw-alias-border-l2,var(--ws-bg-3));border-radius:var(--ws-r-sm);padding:6px 10px;font-size:12px;font-family:inherit}
.ws-input:focus{outline:2px solid var(--ws-accent);outline-offset:1px}
.ws-card textarea.ws-input{resize:vertical;min-height:56px}
.ws-row{display:flex;gap:8px}
.ws-row .ws-field{flex:1}
.ws-err{font-size:11px;color:var(--ws-danger)}
.ws-footRow{display:flex;align-items:center;justify-content:flex-end;gap:8px}
.ws-delBtn{color:var(--ws-danger);border-color:rgba(255,59,48,.45)}
.ws-delBtn:hover{background:rgba(255,59,48,.1)}
.ws-runSel{font-size:12px;background:var(--dsw-alias-bg-layer-1,var(--ws-bg));color:var(--dsw-alias-label-primary,var(--ws-label));border:1px solid var(--dsw-alias-border-l2,var(--ws-bg-3));border-radius:var(--ws-r-sm);padding:4px 6px}
.ws-btn:focus-visible,.ws-palItem:focus-visible,.ws-chatInput:focus-visible,.ws-input:focus-visible,.ws-modeSel:focus-visible,.ws-runSel:focus-visible,.ws-nodeDel:focus-visible,.ws-agentDel:focus-visible,.ws-menuBtn:focus-visible,.ws-addAgent:focus-visible,.ws-fileBtn:focus-visible,.ws-rollback:focus-visible,.ws-agentCard:focus-visible,.ws-loopAdd:focus-visible,.ws-subDel:focus-visible{outline:2px solid var(--ws-accent);outline-offset:2px}
@media (prefers-reduced-motion:reduce){.ws-card{animation:none}.ws-msg{animation:none}.ws-btn,.ws-node,.ws-fileRow,.ws-fileBtn,.ws-reviewItem{transition:none}.ws-edgeFlow{animation:none}.ws-ring{animation:none}.ws-edgeActive path{animation:none}}
`;
		const tagId = "@eave_bounty/dsh-workflow-studio/styles";
		if (typeof document !== "undefined" && document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`) === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@eave_bounty/dsh-workflow-studio";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		//#endregion

		//#region locales
		const NS = "workflow-studio";
		const zh = {
			"view.workflow": "工作流",
			"title": "工作流编排",
			"sub": "自由画布 · 分支并行 · 负反馈循环",
			"loading": "加载中…",
			"save": "保存",
			"saved": "已保存",
			"export": "导出",
			"import": "导入",
			"confirm": "确认",
			"cancel": "取消",
			"rf.fail": "React Flow 注入失败（离线）",
			"chat.title": "流程创建对话",
			"chat.placeholder": "用自然语言描述你想构建的工作流…",
			"chat.generate": "生成工作流",
			"chat.grow": "追加节点",
			"chat.clear": "清空对话",
			"chat.empty": "输入需求并点击「生成工作流」；AI 会以根节点为起点生成一棵可编辑的树，之后可在画布上增删改连。",
			"chat.user": "我",
			"chat.assistant": "流程创建器",
			"chat.generated": "已生成树形工作流：{n} 个节点，{m} 条连线。可在画布上继续编辑，或直接运行。",
			"chat.appended": "已追加节点「{title}」。",
			"chat.failed": "生成失败，请重试。",
			"canvas.empty": "画布为空 —— 拖拽左侧 Agent 到画布，或点「生成工作流」。",
			"palette": "节点面板",
			"pal.root": "起点",
			"pal.plan": "计划",
			"pal.action": "执行",
			"pal.review": "审核",
			"pal.summary": "总结",
			"pal.dimension": "维度",
			"pal.loop": "循环",
			"menu.title": "工作流",
			"menu.plan": "计划",
			"menu.action": "执行",
			"menu.review": "审核",
			"menu.loop": "循环",
			"menu.planDesc": "规划目标与步骤",
			"menu.actionDesc": "执行并产出结果",
			"menu.reviewDesc": "审核并给出反馈",
			"menu.loopDesc": "循环迭代收敛",
			"drawer.agents": "Agent 列表",
			"drawer.hint": "拖拽 Agent 到画布生成节点；或点下方「+ 自定义」新增。",
			"drawer.custom": "自定义 Agent",
			"agent.added": "已创建 Agent「{name}」",
			"sem.edge": "连线作用：{detail}",
			"sem.nodeNamed": "已按语义自动命名「{title}」",
			"gen.fail": "生成失败：{err}",
			"gen.replace": "画布已有内容，确定用生成结果替换吗？",
			"gen.heuristic": "已用本地解析生成（原生引擎不可用）",
			"node.editTitle": "节点设置",
			"node.agent": "代理",
			"node.delete": "删除该节点？",
			"node.prompt": "提示词",
			"node.outNone": "无输出",
			"node.outFile": "文件输出",
			"node.outText": "文本输出",
			"node.outPath": "输出文件路径",
			"node.outTextLabel": "输出文本",
			"node.loopMode": "启用循环（评分闸门）",
			"node.threshold": "放行阈值",
			"node.maxAttempts": "最大尝试次数",
			"file.attach": "添加文件",
			"file.bubble": "产出文件",
			"edge.title": "连线语义",
			"edge.intent": "意图",
			"edge.label": "标签",
			"edge.threshold": "放行阈值",
			"edge.delete": "删除该连线？",
			"edge.ctx": "注入上下文",
			"edge.artifact": "传递产出",
			"edge.promptInject": "注入提示词",
			"edge.output": "分支输出",
			"edge.reviewFeedback": "检查反馈",
			"edge.loopGate": "Loop 评分闸门",
			"edge.custom": "自定义",
			"run": "运行",
			"run.running": "运行中…",
			"run.sim": "仿真模式（原生引擎未启用）",
			"run.simOffline": "仿真模式（离线）",
			"run.agents": "已启动 {n} 个子代理",
			"run.stop": "停止原因：{r}",
			"run.empty": "画布为空，请先生成或添加节点",
			"run.error": "运行失败",
			"runtime.pending": "执行中…",
			"runtime.doneNone": "（待概括）",
			"runtime.flagged": "未达标",
			"rollback": "回退",
			"loop.score": "评分",
			"loop.threshold": "阈值",
			"loop.attempts": "最多",
			"loop.empty": "把要反复执行的内容拖进循环体（或点 + 添加）",
			"loop.add": "向循环体添加子节点",
			"loop.added": "已把「{title}」放入循环体",
			"review.add": "添加意见",
			"review.addPrompt": "输入审核意见：维度 / 问题（用 / 分隔）",
			"review.dim": "综合审核",
			"agents.title": "代理注册表",
			"agents.add": "添加代理",
			"agents.id": "代理 ID",
			"agents.name": "名称",
			"agents.role": "角色",
			"agents.prompt": "提示词",
			"agents.dup": "ID 已存在",
			"agents.custom": "自定义",
			"set.bubbleLabel": "节点气泡显示模式",
			"set.bubbleDefault": "常显（默认）",
			"set.bubbleFloat": "悬浮",
			"mode.normal": "普通",
			"mode.loop": "Loop",
			"sim.sum.file": "「{title}」产出文件：{path}。",
			"sim.sum.plan": "「{title}」已完成：产出可分步执行的计划与分工。",
			"sim.sum.action": "「{title}」已完成：执行并产出可用结果。",
			"sim.sum.summary": "「{title}」已完成：汇总上游产出形成结构化分析。",
			"sim.sum.review": "「{title}」审核完成：评分 {score}，{issues}。",
			"sim.sum.dimension": "「{title}」完成单维度审核。",
			"sim.sum.loop": "「{title}」循环完成（评分 {score}）。",
			"sim.sum.root": "「{title}」启动流程。",
			"sim.sum.default": "「{title}」已完成。",
			"sim.dim": "综合审核",
			"sim.issue.pass": "通过",
			"node.title": "节点标题",
			"node.deleteBtn": "删除节点",
			"agents.delete": "移除代理",
			"chat.keys.line": "\\d+[.、)．]|[-*•]\\s*|\\(\\d+\\)",
			"chat.keys.sentence": "[。；;\\n]+",
			"chat.keys.clause": "[，,、]+",
			"chat.keys.sep": "[/|｜]",
			"chat.keys.review": "审核|检查|评审|review|test|测试",
			"chat.keys.loop": "循环|迭代|loop|iterate|直到|反复",
			"chat.keys.summary": "总结|汇总|分析|summary|报告|report",
			"chat.keys.plan": "计划|规划|拆解|plan",
			"chat.keys.dimension": "维度|角度|dimension|视角",
			"agent.research.name": "调研员",
			"agent.research.prompt": "你是资深调研员：第一性原理拆解目标，输出事实清单与资料来源。",
			"agent.analyst.name": "分析师",
			"agent.analyst.prompt": "你是分析师：汇总上游产出，提炼结构化结论与风险。",
			"agent.planner.name": "产品经理",
			"agent.planner.prompt": "你是产品经理：将目标拆解为可分步执行、可分工的计划。",
			"agent.executor.name": "执行者",
			"agent.executor.prompt": "你是执行者：按输入产出可用结果与文件。",
			"agent.reviewer.name": "审核员",
			"agent.reviewer.prompt": "你是多维度审核员：从功能完整性、正确性、风险等角度检查并反馈。"
		};
		const en = {
			"view.workflow": "Workflow",
			"title": "Workflow Studio",
			"sub": "Free canvas · parallel branches · negative feedback",
			"loading": "Loading…",
			"save": "Save",
			"saved": "Saved",
			"export": "Export",
			"import": "Import",
			"confirm": "Confirm",
			"cancel": "Cancel",
			"rf.fail": "React Flow failed to load (offline)",
			"chat.title": "Workflow builder chat",
			"chat.placeholder": "Describe the workflow you want in natural language…",
			"chat.generate": "Generate workflow",
			"chat.grow": "Add node",
			"chat.clear": "Clear chat",
			"chat.empty": "Describe a request and hit “Generate workflow”; the builder grows an editable tree from a root node that you can then edit on the canvas.",
			"chat.user": "You",
			"chat.assistant": "Workflow builder",
			"chat.generated": "Tree workflow generated: {n} nodes, {m} edges. Edit it on the canvas or run it directly.",
			"chat.appended": "Node “{title}” appended.",
			"chat.failed": "Generation failed, please retry.",
			"canvas.empty": "Canvas empty — drag a left agent onto the canvas, or tap “Generate workflow”.",
			"palette": "Nodes",
			"pal.root": "Root",
			"pal.plan": "Plan",
			"pal.action": "Action",
			"pal.review": "Review",
			"pal.summary": "Summary",
			"pal.dimension": "Dimension",
			"pal.loop": "Loop",
			"menu.title": "Workflow",
			"menu.plan": "Plan",
			"menu.action": "Action",
			"menu.review": "Review",
			"menu.loop": "Loop",
			"menu.planDesc": "Plan the goal & steps",
			"menu.actionDesc": "Execute & produce results",
			"menu.reviewDesc": "Review & give feedback",
			"menu.loopDesc": "Iterate until converged",
			"drawer.agents": "Agents",
			"drawer.hint": "Drag an agent onto the canvas to create a node; or hit “+ Custom” to add one.",
			"drawer.custom": "Custom agent",
			"agent.added": "Agent “{name}” created",
			"sem.edge": "Edge role: {detail}",
			"sem.nodeNamed": "Auto-named “{title}”",
			"gen.fail": "Generation failed: {err}",
			"gen.replace": "The canvas already has content — replace it with the generated result?",
			"gen.heuristic": "Generated with local parsing (native engine unavailable)",
			"node.editTitle": "Node settings",
			"node.agent": "Agent",
			"node.delete": "Delete this node?",
			"node.prompt": "Prompt",
			"node.outNone": "No output",
			"node.outFile": "File output",
			"node.outText": "Text output",
			"node.outPath": "Output file path",
			"node.outTextLabel": "Output text",
			"node.loopMode": "Enable loop (score gate)",
			"node.threshold": "Pass threshold",
			"node.maxAttempts": "Max attempts",
			"file.attach": "Attach file",
			"file.bubble": "Output file",
			"edge.title": "Edge intent",
			"edge.intent": "Intent",
			"edge.label": "Label",
			"edge.threshold": "Pass threshold",
			"edge.delete": "Delete this edge?",
			"edge.ctx": "Inject context",
			"edge.artifact": "Pass artifact",
			"edge.promptInject": "Inject prompt",
			"edge.output": "Branch output",
			"edge.reviewFeedback": "Review feedback",
			"edge.loopGate": "Loop score gate",
			"edge.custom": "Custom",
			"run": "Run",
			"run.running": "Running…",
			"run.sim": "Simulation mode (native engine not enabled)",
			"run.simOffline": "Simulation mode (offline)",
			"run.agents": "{n} subagents started",
			"run.stop": "Stop reason: {r}",
			"run.empty": "Canvas is empty — generate or add nodes first",
			"run.error": "Run failed",
			"runtime.pending": "Running…",
			"runtime.doneNone": "(no summary yet)",
			"runtime.flagged": "Not passed",
			"rollback": "Roll back",
			"loop.score": "Score",
			"loop.threshold": "Threshold",
			"loop.attempts": "Max",
			"loop.empty": "Drop what to repeat into the loop body (or tap + to add)",
			"loop.add": "Add a child node to the loop body",
			"loop.added": "“{title}” placed into the loop body",
			"review.add": "Add finding",
			"review.addPrompt": "Enter a review finding: dimension / issue (separate with /)",
			"review.dim": "Overall review",
			"agents.title": "Agent registry",
			"agents.add": "Add agent",
			"agents.id": "Agent ID",
			"agents.name": "Name",
			"agents.role": "Role",
			"agents.prompt": "Prompt",
			"agents.dup": "ID already exists",
			"agents.custom": "Custom",
			"set.bubbleLabel": "Node bubble display mode",
			"set.bubbleDefault": "Always shown (default)",
			"set.bubbleFloat": "Floating on hover",
			"mode.normal": "Normal",
			"mode.loop": "Loop",
			"sim.sum.file": "{title} produced file: {path}.",
			"sim.sum.plan": "{title} done: produced a step-by-step plan with roles.",
			"sim.sum.action": "{title} done: executed and produced usable results.",
			"sim.sum.summary": "{title} done: aggregated upstream outputs into structured analysis.",
			"sim.sum.review": "{title} review done: score {score}, {issues}.",
			"sim.sum.dimension": "{title} finished single-dimension review.",
			"sim.sum.loop": "{title} loop finished (score {score}).",
			"sim.sum.root": "{title} started the flow.",
			"sim.sum.default": "{title} done.",
			"sim.dim": "Overall review",
			"sim.issue.pass": "Pass",
			"node.title": "Title",
			"node.deleteBtn": "Delete node",
			"agents.delete": "Remove agent",
			"chat.keys.line": "\\d+[.)]|[-*]\\s*|\\(\\d+\\)",
			"chat.keys.sentence": "[;.\\n]+",
			"chat.keys.clause": "[,]+",
			"chat.keys.sep": "[/|]",
			"chat.keys.review": "review|check|audit|test",
			"chat.keys.loop": "loop|iterate|until|repeat",
			"chat.keys.summary": "summary|aggregate|analy|report",
			"chat.keys.plan": "plan|planning|breakdown|steps",
			"chat.keys.dimension": "dimension|angle|perspective",
			"agent.research.name": "Researcher",
			"agent.research.prompt": "You are a senior researcher: break the goal down from first principles and output facts with sources.",
			"agent.analyst.name": "Analyst",
			"agent.analyst.prompt": "You are an analyst: aggregate upstream outputs and distill structured conclusions and risks.",
			"agent.planner.name": "Product manager",
			"agent.planner.prompt": "You are a product manager: break the goal into a step-by-step, distributable plan.",
			"agent.executor.name": "Executor",
			"agent.executor.prompt": "You are an executor: turn inputs into usable results and files.",
			"agent.reviewer.name": "Reviewer",
			"agent.reviewer.prompt": "You are a multi-dimension reviewer: check and give feedback on completeness, correctness, and risk."
		};
		//#endregion

		//#region UMD injection
		function injectScript(src) {
			return new Promise((resolve, reject) => {
				if (typeof document === "undefined") { resolve(); return; }
				const s = document.createElement("script");
				s.src = src; s.async = true;
				s.onload = () => resolve();
				s.onerror = () => reject(new Error("failed to load " + src));
				document.head.appendChild(s);
			});
		}
		// In DSH web the client bundle is served offline-friendly; prefer local fallback via CDN.
		// @xyflow/react UMD does NOT embed its CSS — dist/style.css is mandatory and must be
		// injected separately or the canvas renders unstyled.
		function ensureRuntime(onReady) {
			const load = async () => {
				if (window.ReactFlow && window.gsap) { injectRfStyle(); onReady(); return; }
				try {
					if (!window.ReactFlow) {
						await injectScript("https://cdn.jsdelivr.net/npm/@xyflow/react@12.11.3/dist/umd/index.js");
						injectRfStyle();
					}
					if (!window.gsap) await injectScript("https://cdn.jsdelivr.net/npm/gsap@3.13.0/dist/gsap.min.js");
				} catch (e) { /* offline — will stay degraded */ }
				onReady();
			};
			load();
		}
		// Inject the mandatory React Flow stylesheet once (idempotent).
		function injectRfStyle() {
			if (typeof document === "undefined" || document.querySelector('link[data-rf-style]')) return;
			const lnk = document.createElement("link");
			lnk.rel = "stylesheet";
			lnk.href = "https://cdn.jsdelivr.net/npm/@xyflow/react@12.11.3/dist/style.css";
			lnk.dataset.rfStyle = "1";
			document.head.appendChild(lnk);
		}
		// Derive dark mode from the host theme (respects prefers-color-scheme + DSH).
		function isDarkMode() {
			if (typeof window === "undefined") return false;
			return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
		}
		//#endregion

		//#region constants (mirror lib/tree.js so the client stays self-contained)
		const NODE_KINDS = ["root", "plan", "action", "review", "summary", "dimension", "loop"];
		const EDGE_INTENTS = ["context", "artifact", "prompt-inject", "review-feedback", "loop-gate", "output", "custom"];
		const KIND_COLORS = {
			root: "#FF9500", plan: "#AF52DE", action: "#FF2D55", review: "#FFD60A",
			summary: "#34C759", dimension: "#5E5CE6", loop: "#64D2FF"
		};
		const DEFAULT_AGENT = {
			root: "agent.planner", plan: "agent.planner", action: "agent.executor",
			review: "agent.reviewer", summary: "agent.analyst", dimension: "agent.reviewer", loop: "agent.executor"
		};
		// Local copy of the preset registry (authoritative list fetched from GET /agents).
		// Names/prompts come from the locale dicts so no display text is hardcoded here.
		const presetAgentsFromT = (t) => ({
			"agent.research": { id: "agent.research", name: t("agent.research.name"), role: "research", prompt: t("agent.research.prompt") },
			"agent.analyst": { id: "agent.analyst", name: t("agent.analyst.name"), role: "summary", prompt: t("agent.analyst.prompt") },
			"agent.planner": { id: "agent.planner", name: t("agent.planner.name"), role: "plan", prompt: t("agent.planner.prompt") },
			"agent.executor": { id: "agent.executor", name: t("agent.executor.name"), role: "action", prompt: t("agent.executor.prompt") },
			"agent.reviewer": { id: "agent.reviewer", name: t("agent.reviewer.name"), role: "review", prompt: t("agent.reviewer.prompt") }
		});
		// The FOUR left-menu categories (user-mandated). Each category maps to its default
		// agents (the "presets the user described" — NOT a hardcoded 4-popup) plus any customs.
		const MENU_CATEGORIES = [
			{ key: "plan", label: "menu.plan", desc: "menu.planDesc" },
			{ key: "action", label: "menu.action", desc: "menu.actionDesc" },
			{ key: "review", label: "menu.review", desc: "menu.reviewDesc" },
			{ key: "loop", label: "menu.loop", desc: "menu.loopDesc" }
		];
		const CATEGORY_KIND = { plan: "plan", action: "action", review: "review", loop: "loop" };
		// Default agent ids exposed under each category button (planner/researcher/analyst
		// under Plan, executor under Action, reviewer under Review, executor under Loop).
		const CATEGORY_DEFAULT_AGENTS = { plan: ["agent.planner", "agent.research", "agent.analyst"], action: ["agent.executor"], review: ["agent.reviewer"], loop: ["agent.executor"] };
		const CATEGORY_AGENT_DEFAULT = { plan: "agent.planner", action: "agent.executor", review: "agent.reviewer", loop: "agent.executor" };
		// Self-contained semantic auto-naming (mirror of lib/semantics.js — pure functions).
		const short = (s) => { const t = String(s == null ? "" : s).trim(); return t.length > 12 ? t.slice(0, 12) + "…" : t; };
		const kindColorOf = (kind) => KIND_COLORS[kind] || "#007AFF";
		// Decide what a newly-dropped node is for + its default title.
		const autoNameNode = (kind, opts) => {
			opts = opts || {};
			const hint = (opts.hint && String(opts.hint).trim()) || "";
			const upstream = Array.isArray(opts.upstream) ? opts.upstream : [];
			const k = NODE_KINDS.indexOf(kind) >= 0 ? kind : "action";
			const hintTitle = hint.length > 18 ? hint.slice(0, 18) + "…" : hint;
			let title;
			if (hintTitle) title = hintTitle;
			else if (k === "root") title = "流程起点";
			else if (k === "loop") title = "循环体";
			else if (k === "review") title = upstream.length ? "审核「" + short(upstream[0]) + "」" : "审核";
			else if (k === "action") title = upstream.length ? "执行「" + short(upstream[0]) + "」" : "执行任务";
			else if (k === "plan") title = upstream.length ? "规划「" + short(upstream[0]) + "」" : "规划";
			else title = k === "summary" ? "汇总" : k === "dimension" ? "维度审核" : k;
			return { title };
		};
		// Describe what a connection means (source kind → target kind). Returns intent+label+detail.
		const autoEdge = (fromKind, toKind, opts) => {
			opts = opts || {};
			const f = NODE_KINDS.indexOf(fromKind) >= 0 ? fromKind : "action";
			const t_ = NODE_KINDS.indexOf(toKind) >= 0 ? toKind : "action";
			const fs = short(opts.fromTitle) || "上游", ts = short(opts.toTitle) || "下游";
			if ((f === "review" || f === "dimension") && t_ === "loop") return { intent: "loop-gate", label: "审核「" + ts + "」评分闸门", detail: "「" + fs + "」对「" + ts + "」评分；低于阈值时循环体再次迭代。" };
			if (f === "review" || f === "dimension") return { intent: "review-feedback", label: "审核反馈→「" + ts + "」", detail: "「" + fs + "」的检查意见作为反馈注入「" + ts + "」，驱动修正。" };
			if (t_ === "review" || t_ === "dimension") return { intent: "artifact", label: "产出→审核「" + ts + "」", detail: "「" + fs + "」的产出交给「" + ts + "」审核。" };
			if (t_ === "loop") return { intent: "artifact", label: "输入→循环「" + ts + "」", detail: "「" + fs + "」的产出作为「" + ts + "」循环体的输入。" };
			if (f === "plan") return { intent: "context", label: "计划→「" + ts + "」", detail: "「" + fs + "」制定的计划作为「" + ts + "」的执行依据。" };
			return { intent: "artifact", label: "产出→「" + ts + "」", detail: "「" + fs + "」的产出传递给「" + ts + "」继续处理。" };
		};
		const intentLabelOf = (intent) => {
			const m = { context: "上下文", artifact: "传递产出", "prompt-inject": "注入提示词", "review-feedback": "检查反馈", "loop-gate": "评分闸门", output: "分支输出", custom: "自定义" };
			return m[intent] || "自定义";
		};
		const uid = (p) => p + "-" + Date.now().toString(36) + "-" + ((Math.random() * 1e4) | 0).toString(36);
		const trunc = (s, n) => { const t = String(s == null ? "" : s).trim(); return t.length > n ? t.slice(0, n) + "…" : t; };
		// Normalize custom agents so legacy snapshots/imports without a `category` still show
		// in the drawer (default to "action").
		const normalizeCustomAgents = (list) => (Array.isArray(list) ? list : []).map((a) => (a && a.id && a.category) ? a : (a && a.id ? { ...a, category: a.role === "review" ? "review" : (a.role === "plan" ? "plan" : "action") } : a));
		// Convert a flat host tree {nodes,edges,agents,plan} into React Flow {nodes,edges}.
		const treeToRF = (tree, colors, dagents) => {
			const rfNodes = (tree.nodes || []).map((n) => {
				const data = {
					id: n.id, kind: n.kind || "action", title: n.title || n.id,
					agentId: n.agentId || "", prompt: n.prompt || "",
					files: n.files || [], review: n.review || [], loop: n.loop || {}, out: n.out || null, subGraph: n.subGraph || null,
					runtime: n.runtime || null, iconColor: colors[n.kind] || "#007AFF",
					actionMode: n.kind === "action" ? (n.loop?.mode === "loop" ? "loop" : "normal") : undefined
				};
				return { id: n.id, type: "workflow", position: n.pos || { x: 60 + Math.random() * 120, y: 60 }, data };
			});
			const rfEdges = (tree.edges || []).map((e, i) => ({
				id: e.id || uid("e"), source: e.source, target: e.target, type: "smoothstep",
				label: e.data?.detail || e.intent || "context", labelBgPadding: [4, 2], labelBgBorderRadius: 6, data: { intent: e.intent || "context", detail: e.data?.detail || "", ...(e.data || {}) }
			}));
			return { nodes: rfNodes, edges: rfEdges };
		};
		//#endregion

		//#region icons
		function diamondIcon(color) {
			return jsx("svg", { width: 14, height: 14, viewBox: "0 0 16 16", fill: color || "currentColor", children: jsx("path", { d: "M8 1l5 7-5 7-5-7z" }) });
		}
		function fileIcon() {
			return jsx("svg", { width: 12, height: 12, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", "stroke-width": 1.3, children: [
				jsx("path", { d: "M3 2.5h6l4 4V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1z" }),
				jsx("path", { d: "M9 2.5V6h3.5" })
			] });
		}
		//#endregion

		//#region heuristic helpers (tree building from natural language)
		// Parse free text into discrete steps: numbered/bulleted lines, sentences, clauses.
		// Separator/keyword patterns come from the locale dicts (chat.keys.*).
		function parseSteps(text, keys) {
			const steps = [];
			const raw = String(text || "").replace(/\r/g, "").trim();
			if (!raw) return steps;
			const lines = raw.split("\n").map((s) => s.trim()).filter(Boolean);
			const linePattern = new RegExp("^(" + keys.line + ")", "i");
			for (const ln of lines) {
				const clean = ln.replace(linePattern, "").trim();
				if (clean && clean.length > 1) steps.push(clean);
			}
			if (steps.length >= 2) return steps;
			const sentences = raw.split(new RegExp(keys.sentence)).map((s) => s.trim()).filter((s) => s.length > 1);
			if (sentences.length >= 2) return sentences.slice(0, 8);
			const clauses = raw.split(new RegExp(keys.clause)).map((s) => s.trim()).filter((s) => s.length > 1);
			if (clauses.length >= 3) return clauses.slice(0, 8);
			return steps.length ? steps : [raw];
		}
		// Guess a node kind from the text (keyword heuristics via localized patterns).
		function guessKind(text, keys) {
			const s = String(text || "");
			if (new RegExp(keys.review, "i").test(s)) return "review";
			if (new RegExp(keys.loop, "i").test(s)) return "loop";
			if (new RegExp(keys.summary, "i").test(s)) return "summary";
			if (new RegExp(keys.plan, "i").test(s)) return "plan";
			if (new RegExp(keys.dimension, "i").test(s)) return "dimension";
			return "action";
		}
		// Topological stage grouping (mirror of tree.parallelStages) for the local simulation.
		function computeStages(ns, es) {
			const ids = ns.map((n) => n.id);
			const indeg = new Map(ids.map((id) => [id, 0]));
			const adj = new Map(ids.map((id) => [id, []]));
			for (const e of es || []) {
				if (!indeg.has(e.source) || !indeg.has(e.target)) continue;
				adj.get(e.source).push(e.target);
				indeg.set(e.target, indeg.get(e.target) + 1);
			}
			const stages = [];
			const done = new Set();
			let remaining = ids.length;
			while (remaining > 0) {
				let ready = ids.filter((id) => !done.has(id) && indeg.get(id) === 0);
				if (!ready.length) ready = ids.filter((id) => !done.has(id)); // cycle fallback
				if (!ready.length) break;
				stages.push(ready);
				for (const id of ready) {
					done.add(id);
					for (const nx of adj.get(id) || []) indeg.set(nx, indeg.get(nx) - 1);
				}
				remaining -= ready.length;
			}
			return stages;
		}
		//#endregion

		//#region module-level handlers + shared state
		// Module-level handlers keep callbacks OUT of serialized node.data (functions are
		// dropped by JSON.stringify), so persisted workflows round-trip cleanly.
		let attachHandler = null;
		let rollbackHandler = null;
		let actionModeHandler = null;
		let agentChangeHandler = null;
		let deleteNodeHandler = null;
		let reviewAddHandler = null;
		let loopAddSubHandler = null;
		let loopDelSubHandler = null;
		let viewT = (k) => k;
		let bubbleMode = "default"; // "default" | "float"
		let agentRegistry = {};     // agentId -> {id,name,role,prompt}
		let RFGlobal = null;        // window.ReactFlow (set once runtime is ready)
		// Shared plugin settings (in-memory; also surfaced in the Settings page).
		const pluginSettings = { bubbleMode: "default" };
		// Hoisted nodeTypes so React Flow doesn't recreate every node on each render.
		const workflowNodeTypes = { workflow: (p) => jsx(WorkflowNode, { data: p.data, selected: p.selected }) };
		//#endregion

		//#region node component
		function WorkflowNode({ data, selected }) {
			const rt = data.runtime || { status: "idle", summary: "", detail: "", history: [] };
			const kind = data.kind || "action";
			const isLoop = kind === "loop" || (data.loop && data.loop.mode === "loop");
			const isReview = kind === "review" || kind === "dimension";
			const agent = agentRegistry[data.agentId];
			const reviewItems = isReview && Array.isArray(data.review) ? data.review : [];
			const outFile = data.out && data.out.type === "file";
			const bubbleCls = "ws-bubble" + (rt.status === "done" ? "" : " pending") + (bubbleMode === "float" ? " hidden" : "");
			const kindColor = data.iconColor || KIND_COLORS[kind] || "var(--ws-accent)";
			// Agent dropdown options: registry entries + a fallback entry so the select never shows blank.
			let agentOptions = Object.keys(agentRegistry).map((k) => agentRegistry[k]);
			if (data.agentId && !agentRegistry[data.agentId]) agentOptions = [{ id: data.agentId, name: data.agentId, role: "", prompt: "" }].concat(agentOptions);
			const RF = RFGlobal;
			// Multi-port: render one handle per connected edge (from data injected at render
			// time) plus one spare, so input (left) / output (right) each accept many links.
			// Capped at 6 per side to avoid overflow on short nodes.
			const nIn = Math.min((data._in || 0), 5);
			const nOut = Math.min((data._out || 0), 5);
			const inHandles = Math.max(1, nIn + 1);
			const outHandles = Math.max(1, nOut + 1);
			const inPorts = [];
			for (let i = 0; i < inHandles; i++) inPorts.push(jsx(RF.Handle, {
				type: "target", position: RF.Position.Left, id: "in-" + i, key: "in-" + i,
				className: "ws-handle ws-handleIn", style: { top: 18 + i * 16 }
			}));
			const outPorts = [];
			for (let i = 0; i < outHandles; i++) outPorts.push(jsx(RF.Handle, {
				type: "source", position: RF.Position.Right, id: "out-" + i, key: "out-" + i,
				className: "ws-handle ws-handleOut", style: { top: 18 + i * 16 }
			}));
			const copyPath = (p) => { try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(String(p || "")); } catch (e) { /* clipboard unavailable */ } };
			// Loop C-shape container: render children (subGraph) as mini-cards that grow the frame.
			if (isLoop) {
				const subNodes = (data.subGraph && Array.isArray(data.subGraph.nodes)) ? data.subGraph.nodes : [];
				return jsxs("div", { className: "ws-node loop-node" + (selected ? " sel" : ""), children: [
					rt.status === "running" ? jsx("div", { className: "ws-ring" }) : null,
					inPorts,
					jsxs("div", { className: "ws-loopFrame", children: [
						jsxs("div", { className: "ws-loopHead", children: [
							jsx("svg", { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 2.2, children: jsx("path", { d: "M20 8a8 8 0 1 0 .5 5" }) }),
							jsx("span", { className: "ws-nodeTitle", children: data.title || "循环体" }),
							jsx("span", { className: "ws-kindTag", style: { color: kindColor, borderColor: kindColor }, children: viewT("pal.loop") }),
							rt.status === "done" ? jsx("span", { className: "ws-status", style: { color: "var(--ws-success)" }, children: "\u2713" }) : null,
							typeof deleteNodeHandler === "function" ? jsx("button", { type: "button", className: "ws-nodeDel", title: viewT("node.delete"), onClick: (e) => { e.stopPropagation(); deleteNodeHandler(data.id); }, children: "\u00d7" }) : null
						] }),
						jsx("div", { className: "ws-nodeSub", style: { marginBottom: 8 }, children: (agent ? agent.name : data.agentId) + (data.prompt ? " · " + data.prompt : "") }),
						jsxs("div", { className: "ws-loopMeta", children: [
							jsx("span", { children: viewT("loop.threshold") + " " + (data.loop && data.loop.threshold != null ? data.loop.threshold : "0.7") }),
							jsx("span", { children: viewT("loop.attempts") + " " + (data.loop && data.loop.maxAttempts != null ? data.loop.maxAttempts : "3") }),
							rt.score != null ? jsx("span", { style: { color: "var(--ws-accent)" }, children: viewT("loop.score") + " " + (typeof rt.score === "number" ? rt.score.toFixed(2) : rt.score) }) : null,
							rt.flagged ? jsx("span", { className: "ws-flagged", children: viewT("runtime.flagged") }) : null
						] }),
						jsxs("div", { className: "ws-loopBody", children: [
							subNodes.length === 0 ? jsx("div", { className: "ws-loopEmpty", children: viewT("loop.empty") }) : null,
							subNodes.map((sn) => jsxs("div", {
								className: "ws-loopSub", key: sn.id, title: sn.prompt || sn.title,
								children: [
									diamondIcon(kindColorOf(sn.kind)),
									jsx("span", { className: "ws-title", children: sn.title || sn.id }),
									jsx("span", { style: { color: kindColorOf(sn.kind), fontSize: 9 }, children: viewT("pal." + (sn.kind || "action")) }),
									typeof loopDelSubHandler === "function" ? jsx("button", { type: "button", className: "ws-subDel", title: viewT("node.delete"), onClick: (e) => { e.stopPropagation(); loopDelSubHandler(data.id, sn.id); }, children: "\u00d7" }) : null
								]
							})),
							typeof loopAddSubHandler === "function" ? jsx("button", { type: "button", className: "ws-loopAdd", onClick: (e) => { e.stopPropagation(); loopAddSubHandler(data.id); }, children: "+ " + viewT("loop.add") }) : null
						] }),
						rt.status === "done" ? jsxs("div", { className: bubbleCls, children: [
							jsx("div", { className: "ws-sum", children: rt.summary || viewT("runtime.doneNone") }),
							rt.detail ? jsx("div", { className: "ws-detail", children: rt.detail }) : null
						] }) : null,
						rt.status === "done" && typeof rollbackHandler === "function" && rt.history && rt.history.length ? jsx("button", { type: "button", className: "ws-rollback", onClick: (e) => { e.stopPropagation(); rollbackHandler(data.id); }, children: viewT("rollback") }) : null
					] }),
					outPorts
				] });
			}
			return jsxs("div", { className: "ws-node" + (selected ? " sel" : "") + (bubbleMode === "float" ? " bubble-float" : " bubble-default"), children: [
				rt.status === "running" ? jsx("div", { className: "ws-ring" }) : null,
				inPorts,
				jsxs("div", { className: "ws-nodeHead", children: [
					diamondIcon(kindColor),
					jsx("span", { className: "ws-nodeTitle", children: data.title || data.id }),
					rt.status === "done" ? jsx("span", { className: "ws-status", style: { color: "var(--ws-success)" }, children: "\u2713" }) : null,
					jsx("span", { className: "ws-kindTag", style: { color: kindColor, borderColor: kindColor }, children: viewT("pal." + kind) }),
					typeof deleteNodeHandler === "function" ? jsx("button", { type: "button", className: "ws-nodeDel", title: viewT("node.delete"), onClick: (e) => { e.stopPropagation(); deleteNodeHandler(data.id); }, children: "\u00d7" }) : null
				] }),
				jsx("div", { className: "ws-nodeSub", children: (data.purpose && !data.prompt) ? data.purpose : ((agent ? agent.name : data.agentId) + (data.prompt ? " · " + data.prompt : "")) }),
				jsxs("div", { className: "ws-row", children: [
					kind === "action" ? jsx("select", {
						className: "ws-modeSel", value: data.actionMode || "normal", title: viewT("mode.normal") + "/PTC/" + viewT("mode.loop"),
						onClick: (e) => e.stopPropagation(),
						onChange: (e) => { if (actionModeHandler) actionModeHandler(data.id, e.target.value); },
						children: [
							jsx("option", { value: "normal", children: viewT("mode.normal") }),
							jsx("option", { value: "ptc", children: "PTC" }),
							jsx("option", { value: "loop", children: viewT("mode.loop") })
						]
					}) : null,
					jsx("select", {
						className: "ws-modeSel ws-agentSel", value: data.agentId || "", title: viewT("node.agent"),
						onClick: (e) => e.stopPropagation(),
						onChange: (e) => { if (agentChangeHandler) agentChangeHandler(data.id, e.target.value); },
						children: agentOptions.map((a) => jsx("option", { value: a.id, key: a.id, children: a.name + (a.role ? " (" + a.role + ")" : "") }))
					})
				] }),
				reviewItems.length ? jsxs("div", { className: "ws-reviewList", children: reviewItems.map((r, i) => jsxs("div", {
					className: "ws-reviewItem" + (r.pass ? " pass" : " fail"), key: i,
					children: [jsx("span", { className: "ws-dim", children: r.dimension }), jsx("span", { className: "ws-issue", children: r.issue })]
				})) }) : null,
				isReview && typeof reviewAddHandler === "function" ? jsx("button", { type: "button", className: "ws-fileBtn", onClick: (e) => { e.stopPropagation(); reviewAddHandler(data.id); }, children: viewT("review.add") }) : null,
				Array.isArray(data.files) && data.files.length ? jsxs("div", { className: "ws-files", children: data.files.map((f) => jsx("div", {
					className: "ws-fileRow", key: f.id, title: f.summary || f.path || f.name,
					onClick: (e) => { e.stopPropagation(); copyPath(f.path || f.name); },
					children: [fileIcon(), jsx("span", { children: f.name })]
				})) }) : null,
				outFile ? jsx("div", { className: "ws-outRow", title: data.out.path || data.out.text || "", onClick: (e) => { e.stopPropagation(); copyPath(data.out.path || ""); }, children: [fileIcon(), jsx("span", { className: "ws-outName", children: data.out.path || viewT("file.bubble") })] }) : null,
				typeof attachHandler === "function" ? jsx("button", { type: "button", className: "ws-fileBtn", onClick: (e) => { e.stopPropagation(); attachHandler(data.id); }, children: viewT("file.attach") }) : null,
				rt.status === "done" ? jsxs("div", { className: bubbleCls, children: [
					jsx("div", { className: "ws-sum", children: rt.summary || viewT("runtime.doneNone") }),
					rt.detail ? jsx("div", { className: "ws-detail", children: rt.detail }) : null
				] }) : (rt.status === "running" ? jsx("div", { className: bubbleCls + " pending", children: viewT("runtime.pending") }) : null),
				rt.status === "done" && typeof rollbackHandler === "function" && rt.history && rt.history.length ? jsx("button", { type: "button", className: "ws-rollback", onClick: (e) => { e.stopPropagation(); rollbackHandler(data.id); }, children: viewT("rollback") }) : null,
				outPorts
			] });
		}
		//#endregion

		//#region WorkflowView
		function WorkflowView({ t, sessionId }) {
			const [ready, setReady] = react.useState(false);
			const [nodes, setNodes] = react.useState([]);
			const [edges, setEdges] = react.useState([]);
			const [plan, setPlan] = react.useState("");
			const [overlay, setOverlay] = react.useState(null); // {type:'node'|'edge'|'agent', ...}
			const [saved, setSaved] = react.useState(false);
			const [openCat, setOpenCat] = react.useState(null); // 'plan'|'action'|'review'|'loop'|null
			const [customAgents, setCustomAgents] = react.useState([]); // {id,name,role,prompt,category}
			const [presetAgents, setPresetAgents] = react.useState(() => presetAgentsFromT(t));
			const [bubbleModeState, setBubbleModeState] = react.useState(pluginSettings.bubbleMode || "default");
			const [runId, setRunId] = react.useState(1);
			const [running, setRunning] = react.useState(false);
			const [simMode, setSimMode] = react.useState("none"); // none | engine | offline
			const [runInfo, setRunInfo] = react.useState(null);   // {agents?, reason?, error?}
			const [toast, setToast] = react.useState(""); // transient auto-naming / feedback notice
			const pendingAnimateRef = react.useRef(new Set());
			const fileInputRef = react.useRef(null);
			const rfInstanceRef = react.useRef(null);
			const edgesRef = react.useRef(edges);
			react.useEffect(() => { edgesRef.current = edges; }, [edges]);
			const showToast = (msg) => {
				if (!msg) return;
				setToast(msg);
				window.setTimeout(() => setToast((cur) => (cur === msg ? "" : cur)), 2600);
			};

			const fmt = (key, vars) => {
				let s = t(key);
				if (vars) for (const k in vars) s = s.split("{" + k + "}").join(String(vars[k] == null ? "" : vars[k]));
				return s;
			};

			// Localized heuristic patterns (separators + kind keywords) for chat generation.
			const kindKeys = {
				line: t("chat.keys.line"), sentence: t("chat.keys.sentence"), clause: t("chat.keys.clause"), sep: t("chat.keys.sep"),
				review: t("chat.keys.review"), loop: t("chat.keys.loop"), summary: t("chat.keys.summary"), plan: t("chat.keys.plan"), dimension: t("chat.keys.dimension")
			};

			react.useEffect(() => {
				ensureRuntime(() => { RFGlobal = window.ReactFlow || null; setReady(true); });
			}, []);

			// Authoritative preset registry (fallback: local copy).
			react.useEffect(() => {
				fetch("/api/dsh-workflow-studio/agents").then((r) => r.json()).then((d) => {
					if (d && d.ok && Array.isArray(d.agents)) {
						const map = {};
						d.agents.forEach((a) => { if (a && a.id) map[a.id] = { id: a.id, name: a.name, role: a.role, prompt: a.prompt }; });
						if (Object.keys(map).length) setPresetAgents(map);
					}
				}).catch(() => { /* offline — local copy */ });
			}, []);

			// Restore the last full-fidelity snapshot (server normalizeWorkflow strips fields,
			// so localStorage is the source of truth across reloads).
			react.useEffect(() => {
				try {
					const raw = window.localStorage.getItem("dsh-workflow-studio.tree.v2");
					if (raw) {
						const data = JSON.parse(raw);
						if (Array.isArray(data.nodes)) { setNodes(data.nodes); setEdges(data.edges || []); }
						if (typeof data.plan === "string") setPlan(data.plan);
						if (Array.isArray(data.customAgents)) setCustomAgents(normalizeCustomAgents(data.customAgents));
					}
				} catch (e) { /* invalid snapshot */ }
			}, []);
			// Skip the first save so a fresh mount never clobbers the restored snapshot before
			// the restore effect's setState lands (functional-review finding 11).
			const restoredRef = react.useRef(false);
			react.useEffect(() => {
				if (!restoredRef.current) { restoredRef.current = true; return; }
				try { window.localStorage.setItem("dsh-workflow-studio.tree.v2", JSON.stringify({ nodes, edges, plan, customAgents })); } catch (e) { /* quota */ }
			}, [nodes, edges, plan, customAgents]);

			const buildAgentRegistry = () => {
				const m = { ...presetAgents };
				customAgents.forEach((a) => { if (a && a.id) m[a.id] = a; });
				return m;
			};
			// Module-scope mirror so WorkflowNode can read the registry without prop drilling.
			agentRegistry = buildAgentRegistry();
			viewT = t;

			// Keep module-level handlers in sync with this view instance.
			react.useEffect(() => {
				attachHandler = attachFile;
				rollbackHandler = rollbackNode;
				actionModeHandler = setActionMode;
				agentChangeHandler = setNodeAgent;
				deleteNodeHandler = deleteNode;
				reviewAddHandler = addReviewItem;
				loopAddSubHandler = addLoopSub;
				loopDelSubHandler = delLoopSub;
			}, [nodes, edges, plan, customAgents, presetAgents, bubbleModeState, t]);

			// M5: animate newly added nodes (pop-in) once rendered.
			react.useEffect(() => {
				if (pendingAnimateRef.current.size === 0) return;
				const timer = window.setTimeout(() => {
					pendingAnimateRef.current.forEach((id) => {
						const el = document.querySelector(`.react-flow__node[data-id="${id}"] .ws-node`);
						if (el) { playNodeIn(el); pendingAnimateRef.current.delete(id); }
					});
				}, 50);
				return () => window.clearTimeout(timer);
			}, [nodes]);

			const sleep = (ms) => new Promise((r) => window.setTimeout(r, ms));

			// ---- node data mutations ----
			const setNodeRuntime = (id, patch) => {
				setNodes((prev) => prev.map((n) => {
					if (n.id !== id) return n;
					const rt = { status: "idle", summary: "", detail: "", history: [], ...(n.data.runtime || {}), ...patch };
					if (patch.status === "done") rt.history = [...(rt.history || []), { runId: rt.runId, status: "done", summary: rt.summary, detail: rt.detail, at: Date.now() }];
					return { ...n, data: { ...n.data, runtime: rt } };
				}));
			};

			const attachFile = (nodeId) => {
				const name = window.prompt(t("file.attach"));
				if (!name) return;
				setNodes((prev) => prev.map((n) => {
					if (n.id !== nodeId) return n;
					const files = Array.isArray(n.data.files) ? n.data.files : [];
					return { ...n, data: { ...n.data, files: [...files, { id: "f-" + Date.now(), name, path: name, kind: "doc" }] } };
				}));
			};

			const addReviewItem = (nodeId) => {
				const raw = window.prompt(t("review.addPrompt"));
				if (!raw) return;
				const parts = raw.split(new RegExp(kindKeys.sep));
				const dim = (parts[0] || "").trim() || t("review.dim");
				const issue = (parts[1] || "").trim() || "";
				setNodes((prev) => prev.map((n) => n.id === nodeId
					? { ...n, data: { ...n.data, review: [...(Array.isArray(n.data.review) ? n.data.review : []), { dimension: dim, issue: issue, pass: false }] } }
					: n));
			};

			// Loop C-shape container: add/remove a child node inside a loop's subGraph.
			const patchLoopSub = (nodeId, fn) => {
				setNodes((prev) => prev.map((n) => {
					if (n.id !== nodeId) return n;
					const sub = n.data.subGraph && typeof n.data.subGraph === "object" ? n.data.subGraph : { nodes: [], edges: [] };
					return { ...n, data: { ...n.data, subGraph: fn(sub, n) } };
				}));
			};
			const addLoopSub = (nodeId, spec) => {
				spec = spec || {};
				const kind = spec.kind || "action";
				const subId = uid(kind);
				const agent = agentRegistry[spec.agentId] || null;
				const { title } = autoNameNode(kind, { hint: spec.title, upstream: [] });
				const subNode = { id: subId, kind, title, agentId: spec.agentId || CATEGORY_AGENT_DEFAULT[kind] || DEFAULT_AGENT[kind], prompt: (spec.prompt || (agent ? agent.prompt : "")) || "", files: [], review: [], loop: {}, out: null };
				patchLoopSub(nodeId, (sub) => ({ ...sub, nodes: [...(sub.nodes || []), subNode] }));
				pendingAnimateRef.current.add(nodeId);
				return subId;
			};
			const delLoopSub = (nodeId, subId) => {
				patchLoopSub(nodeId, (sub) => ({ ...sub, nodes: (sub.nodes || []).filter((s) => s.id !== subId), edges: (sub.edges || []).filter((e) => e.source !== subId && e.target !== subId) }));
			};

			const deleteNode = (id) => {
				if (!window.confirm(t("node.delete"))) return;
				setNodes((prev) => prev.filter((n) => n.id !== id));				setEdges((prev) => prev.filter((e) => e.source !== id && e.target !== id));
			};

			const setActionMode = (id, mode) => {
				setNodes((prev) => prev.map((n) => n.id === id
					? { ...n, data: {
						...n.data,
						actionMode: mode,
						loop: mode === "loop"
							? { mode: "loop", threshold: (n.data.loop && n.data.loop.threshold) || 0.7, maxAttempts: (n.data.loop && n.data.loop.maxAttempts) || 3 }
							: { ...(n.data.loop || {}), mode: undefined }
					} }
					: n));
			};

			const setNodeAgent = (id, agentId) => {
				setNodes((prev) => prev.map((n) => n.id === id ? { ...n, data: { ...n.data, agentId } } : n));
			};

			const rollbackNode = (id) => {
				const rt = nodes.find((n) => n.id === id)?.data?.runtime;
				if (!rt || !rt.history || !rt.history.length) return;
				setNodes((prev) => {
					const nextRt = { ...rt, pointer: Math.max(0, (rt.pointer ?? rt.history.length) - 1) };
					const patch = new Map();
					patch.set(id, { ...nextRt, status: "idle", summary: "", detail: "" });
					const stack = [id];
					while (stack.length) {
						const cur = stack.pop();
						for (const e of edgesRef.current) {
							if (e.source !== cur) continue;
							if (!patch.has(e.target)) { patch.set(e.target, { status: "idle", summary: "", detail: "", history: [], pointer: 0 }); stack.push(e.target); }
						}
					}
					return prev.map((n) => patch.has(n.id) ? { ...n, data: { ...n.data, runtime: patch.get(n.id) } } : n);
				});
			};

			// ---- tree building (client → host payload) ----
			const buildTree = () => {
				const treeNodes = nodes.map((n) => ({
					id: n.id,
					kind: n.data.kind || "action",
					title: n.data.title || n.id,
					agentId: n.data.agentId || DEFAULT_AGENT[n.data.kind] || "agent.executor",
					prompt: typeof n.data.prompt === "string" ? n.data.prompt : "",
					files: Array.isArray(n.data.files) ? n.data.files : [],
					review: Array.isArray(n.data.review) ? n.data.review : [],
					loop: n.data.loop || {},
					out: n.data.out || null,
					subGraph: n.data.subGraph || null,
					pos: n.position || { x: 60, y: 60 }
				}));
				const treeEdges = edges.map((e) => ({
					id: e.id,
					source: e.source,
					target: e.target,
					intent: (e.data && e.data.intent) || "custom",
					data: e.data || {}
				}));
				const agents = { ...presetAgents };
				customAgents.forEach((a) => { if (a && a.id) agents[a.id] = a; });
				return { id: "tree-1", name: t("title"), nodes: treeNodes, edges: treeEdges, agents, plan, status: "draft" };
			};

			const intentLabel = (intent) => {
				const m = { context: t("edge.ctx"), artifact: t("edge.artifact"), "prompt-inject": t("edge.promptInject"), "review-feedback": t("edge.reviewFeedback"), "loop-gate": t("edge.loopGate"), output: t("edge.output"), custom: t("edge.custom") };
				return m[intent] || t("edge.custom");
			};

			// ---- run ----
			const applyResults = (value, rid) => {
				const results = (value && value.results) || {};
				const outputs = (value && value.outputs) || {};
				setNodes((prev) => prev.map((n) => {
					const r = results[n.id];
					const out = outputs[n.id];
					let patch = null;
					if (r) {
						patch = { runtime: { status: "done", runId: rid, summary: r.summary || "", detail: r.detail || "", flagged: !!r.flagged, history: [{ runId: rid, status: "done", summary: r.summary || "", detail: r.detail || "", at: Date.now() }] } };
					}
					if (out) {
						patch = patch || {};
						patch.out = { ...(n.data.out || {}), ...out };
						if (!r) patch.runtime = { status: "done", runId: rid, summary: n.data.title + (out.path ? " " + out.path : ""), detail: "", history: [{ runId: rid, status: "done", summary: n.data.title, detail: "", at: Date.now() }] };
					}
					return patch ? { ...n, data: { ...n.data, ...patch } } : n;
				}));
			};

			const simulateDone = (node, rid) => {
				const kind = (node && node.kind) || "action";
				const title = (node && node.title) || "";
				const isLoop = kind === "loop" || (node && node.loop && node.loop.mode === "loop");
				const isReview = kind === "review" || kind === "dimension";
				const threshold = (node && node.loop && node.loop.threshold) || 0.7;
				let score = 0.8 + ((rid * 7 + String(node ? node.id : "").length) % 3) / 10; // deterministic-ish 0.8–0.98
				score = Math.min(1, Math.round(score * 100) / 100);
				const flagged = isLoop && score < threshold;
				let summary = "", detail = "";
				if (node && node.out && node.out.type === "file") {
					summary = fmt("sim.sum.file", { title, path: node.out.path || "" });
				} else if (isLoop) {
					summary = fmt("sim.sum.loop", { title, score: score.toFixed(2) });
					detail = flagged ? t("runtime.flagged") : "";
				} else if (isReview) {
					summary = fmt("sim.sum.review", { title, score: score.toFixed(2), issues: flagged ? t("runtime.flagged") : t("sim.issue.pass") });
				} else {
					const map = { plan: "sim.sum.plan", action: "sim.sum.action", summary: "sim.sum.summary", dimension: "sim.sum.dimension", root: "sim.sum.root" };
					summary = fmt(map[kind] || "sim.sum.default", { title });
				}
				const rt = { status: "done", runId: rid, summary, detail, score, flagged, history: [{ runId: rid, status: "done", summary, detail, at: Date.now() }] };
				if (isReview) rt.review = [{ dimension: t("sim.dim"), issue: flagged ? t("runtime.flagged") : t("sim.issue.pass"), pass: !flagged }];
				return rt;
			};

			const localSimulate = async (tree, rid) => {
				const stages = computeStages(tree.nodes, tree.edges);
				for (const stage of stages) {
					for (const id of stage) setNodeRuntime(id, { status: "running", runId: rid });
					await sleep(650);
					for (const id of stage) {
						const node = tree.nodes.find((n) => n.id === id);
						const rt = simulateDone(node, rid);
						setNodes((prev) => prev.map((n) => n.id === id
							? { ...n, data: { ...n.data, runtime: rt, out: node && node.out ? { ...(n.data.out || {}), ...node.out } : n.data.out } }
							: n));
					}
				}
			};

			const run = async () => {
				if (running) return;
				const tree = buildTree();
				if (!tree.nodes.length) { setRunInfo({ error: t("run.empty") }); return; }
				setRunning(true);
				setSimMode("none");
				setRunInfo(null);
				const rid = runId;
				setRunId(rid + 1);
				try {
					const res = await fetch("/api/dsh-workflow-studio/run", {
						method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId, tree })
					});
					const data = await res.json();
					if (data && data.ok) {
						applyResults(data.value, rid);
						setRunInfo({ agents: data.agentsStarted, reason: data.stopReason });
					} else if (data && data.simulation) {
						setSimMode("engine");
						await localSimulate(tree, rid);
					} else {
						setRunInfo({ error: (data && data.error) || t("run.error") });
					}
				} catch (err) {
					setSimMode("offline");
					await localSimulate(tree, rid);
				} finally {
					setRunning(false);
				}
			};

			// ---- chat-driven generation ----
			const buildGeneratedTree = (text, keys) => {
				const steps = parseSteps(text, keys);
				const planText = text.trim();
				const hasLoop = new RegExp(keys.loop, "i").test(text);
				const nActions = Math.min(Math.max(steps.length, 1), 6);
				const nodes = [];
				const edges = [];
				const cx = 260;
				const Y = { root: 40, plan: 200, action: 380, review: 560, summary: 740 };
				const mk = (kind, title, agentId, prompt, x, y) => {
					const id = uid(kind);
					const data = { id, kind, title, agentId, prompt, files: [], review: [], loop: {}, out: null, runtime: null, iconColor: KIND_COLORS[kind], actionMode: kind === "action" ? "normal" : undefined };
					if (kind === "loop") data.loop = { mode: "loop", threshold: 0.7, maxAttempts: 3 };
					nodes.push({ id, type: "workflow", position: { x, y }, data });
					return id;
				};
				const link = (src, tgt, intent, label, extra) => {
					edges.push({ id: uid("e"), source: src, target: tgt, type: "smoothstep", label, labelBgPadding: [4, 2], labelBgBorderRadius: 6, data: { intent, detail: label, ...(extra || {}) } });
				};
				const root = mk("root", t("pal.root"), DEFAULT_AGENT.root, planText, cx - 70, Y.root);
				const planN = mk("plan", t("pal.plan"), DEFAULT_AGENT.plan, planText.slice(0, 80), cx - 70, Y.plan);
				link(root, planN, "context", t("edge.ctx"));
				const actionIds = [];
				const w = 210;
				const startX = cx - ((nActions - 1) * w) / 2 - 90;
				steps.slice(0, nActions).forEach((s, i) => {
					const kind = hasLoop && i === nActions - 1 ? "loop" : "action";
					const id = mk(kind, trunc(s, 16), DEFAULT_AGENT[kind], s, startX + i * w, Y.action);
					actionIds.push(id);
					link(planN, id, "artifact", t("edge.artifact"));
				});
				const reviewN = mk("review", t("pal.review"), DEFAULT_AGENT.review, "", cx - 70, Y.review);
				actionIds.forEach((id) => link(id, reviewN, "artifact", t("edge.artifact")));
				if (hasLoop && actionIds.length) link(reviewN, actionIds[actionIds.length - 1], "loop-gate", t("edge.loopGate"), { threshold: 0.7 });
				const sumN = mk("summary", t("pal.summary"), DEFAULT_AGENT.summary, "", cx - 70, Y.summary);
				link(reviewN, sumN, "artifact", t("edge.artifact"));
				return { nodes, edges };
			};

			// Compact prompt → graph generation. Triggered from the toolbar modal so the user
			// keeps the DeepSeek bottom dialog for conversation and this is a quick "build".
			const generateFromPrompt = async (text) => {
				text = (text || "").trim();
				if (!text) return;
				// Never silently wipe existing work: confirm when the canvas is non-empty.
				if (nodes.length && !window.confirm(t("gen.replace"))) return;
				setOverlay(null);
				let usedHeuristic = false;
				try {
					const res = await fetch("/api/dsh-workflow-studio/generate", {
						method: "POST", headers: { "content-type": "application/json" },
						body: JSON.stringify({ sessionId, prompt: text })
					});
					const data = await res.json();
					if (data && data.ok && data.tree && Array.isArray(data.tree.nodes)) {
						const built = treeToRF(data.tree, KIND_COLORS, DEFAULT_AGENT);
						if (built.nodes.length) { setNodes(built.nodes); setEdges(built.edges); setPlan(text); return; }
					}
					usedHeuristic = true;
				} catch { usedHeuristic = true; }
				const built = buildGeneratedTree(text, kindKeys);
				if (built && built.nodes.length) { setNodes(built.nodes); setEdges(built.edges); setPlan(text); }
				if (usedHeuristic) showToast(t("gen.heuristic"));
			};

			// ---- canvas interactions ----
			// Add a node for a menu category, using the chosen agent + semantic auto-naming.
			const addNodeFor = (kind, agentId, pos) => {
				if (kind === "root" && nodes.some((n) => n.data.kind === "root")) return;
				const id = uid(kind);
				const up = nodes.length ? [nodes[nodes.length - 1].data.title] : [];
				const { title } = autoNameNode(kind, { upstream: up });
				const agent = agentRegistry[agentId] || null;
				const data = {
					id, kind, title,
					agentId: agentId || CATEGORY_AGENT_DEFAULT[kind] || DEFAULT_AGENT[kind],
					prompt: agent ? agent.prompt : "",
					files: [], review: [], loop: {}, out: null, runtime: null,
					iconColor: kindColorOf(kind), actionMode: kind === "action" ? "normal" : undefined,
					purpose: (kind === "review" || kind === "dimension") ? "审核上游产出并给出反馈" : (kind === "plan" ? "拆解目标为可执行计划" : (kind === "loop" ? "循环迭代直至收敛" : "接收输入并产出可用结果"))
				};
				if (kind === "loop") data.loop = { mode: "loop", threshold: 0.7, maxAttempts: 3 };
				setNodes((prev) => [...prev, { id, type: "workflow", position: pos || { x: 120 + Math.random() * 160, y: 80 + Math.random() * 200 }, data }]);
				pendingAnimateRef.current.add(id);
				showToast(String(t("sem.nodeNamed")).split("{title}").join(title));
				return id;
			};
			const addNode = (kind) => addNodeFor(kind, CATEGORY_AGENT_DEFAULT[kind] || DEFAULT_AGENT[kind]);

			const onConnect = (conn) => {
				const from = nodes.find((n) => n.id === conn.source);
				const to = nodes.find((n) => n.id === conn.target);
				if (!from || !to) return;
				const fromKind = from.data.kind || "action";
				const toKind = to.data.kind || "action";
				const fromTitle = from.data.title || "";
				const toTitle = to.data.title || "";
				const mkEdge = (intent, label, detail, threshold) => {
					// record source/target handle ids so multi-port routing stays correct
					const edge = { id: uid("e"), source: conn.source, target: conn.target, sourceHandle: conn.sourceHandle, targetHandle: conn.targetHandle, type: "smoothstep", label, labelBgPadding: [4, 2], labelBgBorderRadius: 6, data: { intent, detail: detail || label, ...(threshold !== undefined ? { threshold } : {}) } };
					setEdges((prev) => [...prev, edge]);
					// Auto-name the DOWNSTREAM node from its new relationship when it still has
					// a generic title (the "连线后自动命名" essence the user asked for).
					renameTargetOnConnect(conn.target, fromKind, toKind, fromTitle);
					showToast(String(t("sem.edge")).split("{detail}").join(detail || label));
					window.setTimeout(() => {
						const path = document.querySelector(`.react-flow__edge[data-id="${edge.id}"] path`);
						if (path) flowEdge(path);
					}, 60);
					setOverlay(null);
				};
				// Rename a downstream node so the connection reads meaningfully.
				const renameTargetOnConnect = (targetId, fKind, tKind, fTitle) => {
					setNodes((prev) => prev.map((n) => {
						if (n.id !== targetId) return n;
						const title = n.data.title || "";
						// Only auto-rename generic/empty titles, never user-customized ones.
						const generic = !title || title === n.id || title === t("pal." + (n.data.kind || "action")) || /^(执行任务|审核|规划|循环体|执行「|审核「|规划「|执行$|审核$|规划$)/.test(title);
						if (!generic) return n;
						const shortF = trunc(fTitle, 12) || "上游";
						let next = title;
						if (tKind === "review" || tKind === "dimension") next = "审核「" + shortF + "」";
						else if (tKind === "action") next = "执行「" + shortF + "」";
						else if (tKind === "plan") next = "规划「" + shortF + "」";
						return next !== title ? { ...n, data: { ...n.data, title: next } } : n;
					}));
				};
				// Semantic auto-naming: infer the edge purpose from source→target kinds + titles.
				if (fromKind === "review" || fromKind === "dimension") {
					const targetAngle = (from.data && from.data.angle) || "";
					const existing = (to.data && Array.isArray(to.data.review)) ? to.data.review.map((r) => r.angle || r.dimension || "").filter(Boolean) : [];
					const useSuggested = toKind !== "loop" && !targetAngle && existing.length > 0;
					const fallback = autoEdge(fromKind, toKind, { fromTitle, toTitle });
					Promise.all([
						fetch("/api/dsh-workflow-studio/review-landing", {
							method: "POST", headers: { "content-type": "application/json" },
							body: JSON.stringify({ reviewKind: fromKind, targetKind: toKind, targetTitle: toTitle })
						}).then((r) => r.json()).catch(() => ({ ok: false })),
						useSuggested
							? fetch("/api/dsh-workflow-studio/review-suggest", {
								method: "POST", headers: { "content-type": "application/json" },
								body: JSON.stringify({ existingAngles: existing })
							}).then((r) => r.json()).catch(() => ({ ok: false }))
							: Promise.resolve(null)
					]).then(([landing, suggestion]) => {
						if (landing && landing.ok) {
							let label = landing.label, detail = landing.detail;
							if (suggestion && suggestion.ok && !suggestion.meta) {
								label = suggestion.angle + "·检查反馈";
								detail = "对「" + toTitle + "」做" + suggestion.angle + "检查与反馈。";
							}
							mkEdge(landing.intent, label, detail, toKind === "loop" ? 0.7 : undefined);
						} else mkEdge(fallback.intent, fallback.label, fallback.detail, undefined);
					}).catch(() => mkEdge(fallback.intent, fallback.label, fallback.detail, undefined));
				} else {
					const g = autoEdge(fromKind, toKind, { fromTitle, toTitle });
					mkEdge(g.intent, g.label, g.detail, undefined);
				}
			};

			// ---- persistence ----
			const exportWorkflow = () => {
				const data = { type: "dsh-workflow-studio", version: 2, name: t("title"), ...buildTree(), customAgents, status: "draft" };
				const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
				const url = URL.createObjectURL(blob);
				const a = document.createElement("a");
				a.href = url; a.download = "workflow.tree.json";
				document.body.appendChild(a); a.click(); a.remove();
				URL.revokeObjectURL(url);
			};

			const mapKind = (k) => {
				if (k === "start") return "root";
				if (k === "research") return "action";
				return NODE_KINDS.indexOf(k) >= 0 ? k : "action";
			};

			const importWorkflow = (file) => {
				if (!file) return;
				const reader = new FileReader();
				reader.onload = () => {
					try {
						const data = JSON.parse(String(reader.result));
						const rawNodes = Array.isArray(data.nodes) ? data.nodes : [];
						const hasRfShape = rawNodes.some((n) => n && typeof n.data === "object" && n.data !== null && n.data.kind);
						const ns = rawNodes.map((nd, i) => {
							if (!nd || typeof nd !== "object") return null;
							let kind, base;
							if (hasRfShape && nd.data) {
								kind = mapKind(nd.data.kind);
								base = { ...nd.data, kind, iconColor: KIND_COLORS[kind] || nd.data.iconColor };
							} else {
								kind = mapKind(nd.kind);
								base = {
									id: String(nd.id || ("n" + i)), kind, title: nd.title || t("pal." + kind),
									agentId: nd.agentId || DEFAULT_AGENT[kind], prompt: nd.prompt || "",
									files: Array.isArray(nd.files) ? nd.files : [], review: Array.isArray(nd.review) ? nd.review : [],
									loop: nd.loop || {}, out: nd.out || null, iconColor: KIND_COLORS[kind]
								};
							}
							return {
								id: String(nd.id || ("n" + i)), type: "workflow",
								position: nd.pos && typeof nd.pos.x === "number" ? { x: nd.pos.x, y: nd.pos.y } : (nd.position || { x: 60 + i * 30, y: 60 + i * 60 }),
								data: { files: [], review: [], loop: {}, out: null, runtime: null, ...base }
							};
						}).filter(Boolean);
						const es = (Array.isArray(data.edges) ? data.edges : []).filter((e) => e && e.source && e.target).map((e) => ({
							id: e.id || ("e-" + e.source + "-" + e.target), source: e.source, target: e.target, type: "smoothstep",
							label: e.label || intentLabel(e.intent), labelBgPadding: [4, 2], labelBgBorderRadius: 6,
							data: e.data || { intent: EDGE_INTENTS.indexOf(e.intent) >= 0 ? e.intent : "context" }
						}));
						setNodes(ns);
						setEdges(es);
						if (typeof data.plan === "string") setPlan(data.plan);
						if (Array.isArray(data.customAgents)) setCustomAgents(normalizeCustomAgents(data.customAgents));
					} catch (err) { /* invalid file */ }
				};
				reader.readAsText(file);
			};

			const save = () => {
				const tree = buildTree();
				const body = { ...tree, id: "default", name: t("title"), status: "draft" };
				fetch("/api/dsh-workflow-studio/workflow", {
					method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
				}).then((r) => r.json()).then(() => { setSaved(true); window.setTimeout(() => setSaved(false), 1500); })
					.catch(() => { setSaved(true); window.setTimeout(() => setSaved(false), 1500); });
			};

			// ---- overlay mutations ----
			const saveNodePatch = (id, patch) => {
				setNodes((prev) => prev.map((n) => n.id === id ? { ...n, data: { ...n.data, ...patch } } : n));
			};
			const saveEdgePatch = (id, patch) => {
				setEdges((prev) => prev.map((e) => e.id === id
					? { ...e, label: patch.label, data: { ...e.data, intent: patch.intent, detail: patch.detail || patch.label, ...(patch.threshold !== undefined ? { threshold: patch.threshold } : {}) } }
					: e));
			};
			const deleteEdge = (id) => { setEdges((prev) => prev.filter((e) => e.id !== id)); };
			const addCustomAgent = (a) => { setCustomAgents((prev) => [...prev, a]); };			const removeCustomAgent = (id) => { setCustomAgents((prev) => prev.filter((a) => a.id !== id)); };

			// ---- derived render values ----
			if (!ready) return jsx("div", { className: "ws-view", children: jsx("div", { className: "ws-title", children: t("loading") }) });
			if (!window.ReactFlow) return jsx("div", { className: "ws-view", children: jsx("div", { className: "ws-title", children: t("rf.fail") }) });

			const RF = window.ReactFlow;
			// nodeTypes is defined at module scope (hoisted) so React Flow doesn't recreate
			// every node on each render.

			const activeEdgeIds = new Set();
			if (running) for (const n of nodes) if (n.data?.runtime?.status === "running") for (const e of edges) if (e.source === n.id) activeEdgeIds.add(e.id);
			const displayEdges = edges.map((e) => activeEdgeIds.has(e.id) ? { ...e, className: "ws-edgeActive", style: { stroke: "#FF3B30" } } : e);
			// Inject per-node input/output connection counts at render time so multi-port
			// handles stay in sync with edges (no shared module state / stale frame).
			const inMap = {}, outMap = {};
			for (const e of edges) { outMap[e.source] = (outMap[e.source] || 0) + 1; inMap[e.target] = (inMap[e.target] || 0) + 1; }
			const displayNodes = nodes.map((n) => ({ ...n, data: { ...n.data, _in: inMap[n.id] || 0, _out: outMap[n.id] || 0, _w: (n.measured && n.measured.width) || (n.data._w) || 240, _h: (n.measured && n.measured.height) || (n.data._h) || 160 } }));

			const onNodesChange = (changes) => setNodes((prev) => (RF.applyNodeChanges ? RF.applyNodeChanges(changes, prev) : prev));
			const onEdgesChange = (changes) => setEdges((prev) => (RF.applyEdgeChanges ? RF.applyEdgeChanges(changes, prev) : prev));
			const onNodeClick = (e, node) => setOverlay({ type: "node", node });
			const onEdgeClick = (e, edge) => setOverlay({ type: "edge", edge });

			const stopText = (() => {
				if (!runInfo) return "";
				const parts = [];
				if (typeof runInfo.agents === "number") parts.push(fmt("run.agents", { n: runInfo.agents }));
				if (runInfo.reason) parts.push(fmt("run.stop", { r: runInfo.reason }));
				return parts.join(" · ");
			})();

			const customIds = new Set(customAgents.map((a) => a.id));
			const existingAgentIds = Object.keys(presetAgents).concat(customAgents.map((a) => a.id));

			// Agents shown in the open category drawer: the category's DEFAULT agents first,
			// then any user-custom agents tagged with this category.
			const drawerAgents = (openCat ? (CATEGORY_DEFAULT_AGENTS[openCat] || []) : []).map((id) => agentRegistry[id]).filter(Boolean)
				.concat(customAgents.filter((a) => a && a.category === openCat));
			const catDef = MENU_CATEGORIES.find((c) => c.key === openCat);

			const menuIcons = {
				plan: jsx("svg", { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 2, children: jsx("path", { d: "M4 6h16M4 12h10M4 18h14" }) }),
				action: jsx("svg", { width: 20, height: 20, viewBox: "0 0 24 24", fill: "currentColor", children: jsx("path", { d: "M6 4l14 8-14 8z" }) }),
				review: jsx("svg", { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 2, children: [
					jsx("circle", { cx: "11", cy: "11", r: "6" }), jsx("path", { d: "M20 20l-4-4" })
				] }),
				loop: jsx("svg", { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 2, children: [
					jsx("path", { d: "M20 8a8 8 0 1 0 .5 5" }), jsx("path", { d: "M20 2v6h-6" })
				] })
			};

			return jsxs("div", { className: "ws-view", children: [
				jsxs("div", { className: "ws-toolbar", children: [
					jsx("h3", { className: "ws-title", children: t("title") }),
					jsx("span", { className: "ws-sub", children: t("sub") }),
					jsx("div", { className: "ws-runbar", children: [
						simMode !== "none" ? jsx("span", { className: "ws-simBadge", children: simMode === "engine" ? t("run.sim") : t("run.simOffline") }) : null,
						stopText ? jsx("span", { className: "ws-status", children: stopText }) : null,
						jsx("button", { type: "button", className: "ws-btn", onClick: () => setOverlay({ type: "gen" }), children: t("chat.generate") }),
						jsx("select", { value: bubbleModeState, onChange: (e) => setBubbleModeState(e.target.value), className: "ws-runSel", title: t("set.bubbleLabel"), children: [
							jsx("option", { value: "default", children: t("set.bubbleDefault") }),
							jsx("option", { value: "float", children: t("set.bubbleFloat") })
						] }),
						jsx("button", { type: "button", className: "ws-btn", onClick: exportWorkflow, title: t("export"), children: t("export") }),
						jsx("button", { type: "button", className: "ws-btn", onClick: () => fileInputRef.current && fileInputRef.current.click(), children: t("import") }),
						jsx("input", { ref: fileInputRef, type: "file", accept: ".json,application/json", style: { display: "none" }, onChange: (e) => { importWorkflow(e.target.files && e.target.files[0]); e.target.value = ""; } }),
						jsx("button", { type: "button", className: "ws-btn" + (running ? "" : " primary"), onClick: run, disabled: running, children: running ? t("run.running") : t("run") }),
						jsx("button", { type: "button", className: "ws-btn", onClick: save, children: saved ? t("saved") : t("save") })
					] })
				] }),
				jsxs("div", { className: "ws-body", children: [
					jsxs("div", { className: "ws-rail", children: [
						jsx("div", { className: "ws-railTitle", children: t("menu.title") }),
						MENU_CATEGORIES.map((c) => jsx("button", {
							type: "button", className: "ws-menuBtn " + c.key + (openCat === c.key ? " open" : ""),
							key: c.key, onClick: () => setOpenCat(openCat === c.key ? null : c.key), title: t(c.desc),
							children: [jsx("span", { className: "ws-mIcon", children: menuIcons[c.key] }), jsx("span", { children: t(c.label) })]
						}))
					] }),
					openCat && catDef ? jsxs("div", { className: "ws-drawer", children: [
						jsxs("div", { className: "ws-drawerHead", children: [
							jsx("span", { className: "ws-cat", children: [jsx("span", { className: "ws-mIcon", children: menuIcons[openCat] }), jsx("span", { children: t(catDef.label) + " · " + t("drawer.agents") })] })
						] }),
						jsx("div", { className: "ws-drawerHint", children: t("drawer.hint") }),
						jsx("div", { className: "ws-agentList", children: drawerAgents.map((a) => jsxs("div", {
							className: "ws-agentCard", key: a.id,
							role: "button", tabIndex: 0, "aria-grabbed": "false", title: a.prompt || a.role,
							draggable: true,
							onDragStart: (e) => { e.dataTransfer.setData("text/plain", JSON.stringify({ kind: openCat, agentId: a.id })); },
							onClick: () => addNodeFor(openCat, a.id),
							onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); addNodeFor(openCat, a.id); } },
							children: [
								jsx("div", { style: { flex: 1, minWidth: 0 }, children: [
									jsxs("div", { className: "ws-agentName", children: [a.name, customIds.has(a.id) ? jsx("span", { className: "ws-agentCustom", children: t("agents.custom") }) : null] }),
									jsx("div", { className: "ws-agentRole", children: a.role }),
									jsx("div", { className: "ws-agentPrompt", children: a.prompt })
								] }),
								customIds.has(a.id) ? jsx("button", { type: "button", className: "ws-agentDel", title: t("agents.delete"), onClick: (e) => { e.stopPropagation(); removeCustomAgent(a.id); }, children: "\u00d7" }) : null
							]
						})) }),
						jsx("button", { type: "button", className: "ws-addAgent", onClick: () => setOverlay({ type: "agent", category: openCat }), children: "+ " + t("drawer.custom") })
					] }) : null,
					jsxs("div", { className: "ws-canvas", children: [
						nodes.length === 0 ? jsx("div", { className: "ws-canvasEmpty", children: t("canvas.empty") }) : null,
						toast ? jsx("div", { className: "ws-toast", role: "status", children: toast }) : null,
						runInfo && runInfo.error && !running ? jsx("div", { className: "ws-runError", children: runInfo.error }) : null,
						jsx(RF.ReactFlow, {
							nodes: displayNodes, edges: displayEdges, nodeTypes: workflowNodeTypes, onConnect, onNodesChange, onEdgesChange,
							onNodeClick, onEdgeClick, fitView: true, colorMode: isDarkMode() ? "dark" : "light", deleteKeyCode: null,
							onInit: (inst) => { rfInstanceRef.current = inst; },
							onDrop: (e) => {
								e.preventDefault();
								const raw = e.dataTransfer.getData("text/plain");
								if (!raw) return;
								try {
									const spec = JSON.parse(raw);
									if (spec && spec.kind && CATEGORY_KIND[spec.kind]) {
										let pos = { x: 120, y: 80 };
										const inst = rfInstanceRef.current;
										if (inst && typeof inst.screenToFlowPosition === "function") {
											pos = inst.screenToFlowPosition({ x: e.clientX, y: e.clientY });
										} else {
											const rf = document.querySelector(".ws-canvas");
											const rect = rf ? rf.getBoundingClientRect() : null;
											pos = { x: rect ? e.clientX - rect.left - 60 : 120, y: rect ? e.clientY - rect.top - 20 : 80 };
										}
										// Scratch-style: dropping onto a LOOP container nests the node into its
										// loop body (subGraph) instead of creating a floating top-level node.
										const loopHit = nodes.find((n) => (n.data && (n.data.kind === "loop" || n.data.loop?.mode === "loop")) && n.position && typeof n.data._w === "number"
											&& pos.x >= n.position.x && pos.x <= n.position.x + (n.data._w || 200)
											&& pos.y >= n.position.y && pos.y <= n.position.y + (n.data._h || 160));
										if (loopHit) {
											const agent = agentRegistry[spec.agentId] || null;
											addLoopSub(loopHit.id, { kind: spec.kind, agentId: spec.agentId, title: agent ? agent.name : spec.kind, prompt: agent ? agent.prompt : "" });
											showToast(String(t("loop.added")).split("{title}").join(agent ? agent.name : spec.kind));
											return;
										}
										addNodeFor(spec.kind, spec.agentId, pos);
									}
								} catch { /* not a drop spec */ }
							},
							onDragOver: (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; },
							children: [
								jsx(RF.Background, {}),
								jsx(RF.MiniMap, {}),
								jsx(RF.Controls, {})
							]
						})
					] })
				] }),
				overlay && overlay.type === "node" ? jsx(NodeEditOverlay, { t, node: overlay.node, agents: agentRegistry, onSave: saveNodePatch, onDelete: deleteNode, onCancel: () => setOverlay(null) }) : null,
				overlay && overlay.type === "edge" ? jsx(EdgeEditOverlay, { t, edge: overlay.edge, onSave: saveEdgePatch, onDelete: deleteEdge, onCancel: () => setOverlay(null) }) : null,
				overlay && overlay.type === "agent" ? jsx(AgentFormOverlay, { t, existingIds: existingAgentIds, category: overlay.category || "action", onSave: addCustomAgent, onCancel: () => setOverlay(null) }) : null,
				overlay && overlay.type === "gen" ? jsx(GenPromptOverlay, { t, onGenerate: generateFromPrompt, onCancel: () => setOverlay(null) }) : null
			] });
		}
		//#endregion

		//#region NodeEditOverlay
		function NodeEditOverlay({ t, node, agents, onSave, onDelete, onCancel }) {
			useDialogEscape(onCancel);
			const d = node.data || {};
			const [title, setTitle] = react.useState(d.title || "");
			const [agentId, setAgentId] = react.useState(d.agentId || "");
			const [prompt, setPrompt] = react.useState(d.prompt || "");
			const [outType, setOutType] = react.useState(d.out && d.out.type ? d.out.type : "none");
			const [outPath, setOutPath] = react.useState((d.out && d.out.path) || "");
			const [outText, setOutText] = react.useState((d.out && d.out.text) || "");
			const [useLoop, setUseLoop] = react.useState(!!(d.loop && d.loop.mode === "loop"));
			const [threshold, setThreshold] = react.useState(String((d.loop && d.loop.threshold) || 0.7));
			const [maxAttempts, setMaxAttempts] = react.useState(String((d.loop && d.loop.maxAttempts) || 3));
			let agentOptions = Object.keys(agents).map((k) => agents[k]);
			if (agentId && !agents[agentId]) agentOptions = [{ id: agentId, name: agentId, role: "", prompt: "" }].concat(agentOptions);
			const save = () => {
				const patch = {
					title: title || d.title || node.id,
					agentId: agentId || DEFAULT_AGENT[d.kind] || "agent.executor",
					prompt,
					out: outType === "none" ? null : { type: outType, path: outPath, text: outText },
					loop: useLoop ? { mode: "loop", threshold: Number(threshold) || 0.7, maxAttempts: Number(maxAttempts) || 3 } : { ...(d.loop || {}), mode: undefined }
				};
				onSave(node.id, patch);
				onCancel();
			};
			return jsx("div", { className: "ws-overlay", role: "dialog", "aria-modal": "true", onClick: (e) => { if (e.target === e.currentTarget) onCancel(); }, children: jsxs("div", { className: "ws-card", children: [
				jsx("h4", { children: t("node.editTitle") }),
				jsx("div", { className: "ws-field", children: [jsx("label", { children: t("node.agent") }), jsx("select", { className: "ws-input", value: agentId, onChange: (e) => setAgentId(e.target.value), children: agentOptions.map((a) => jsx("option", { value: a.id, key: a.id, children: a.name + (a.role ? " (" + a.role + ")" : "") })) })] }),
				jsx("div", { className: "ws-field", children: [jsx("label", { children: t("node.title") }), jsx("input", { className: "ws-input", value: title, onChange: (e) => setTitle(e.target.value) })] }),
				jsx("div", { className: "ws-field", children: [jsx("label", { children: t("node.prompt") }), jsx("textarea", { className: "ws-input", value: prompt, onChange: (e) => setPrompt(e.target.value) })] }),
				jsx("div", { className: "ws-field", children: [jsx("label", { children: t("node.outNone") }), jsx("select", { className: "ws-input", value: outType, onChange: (e) => setOutType(e.target.value), children: [
					jsx("option", { value: "none", children: t("node.outNone") }),
					jsx("option", { value: "file", children: t("node.outFile") }),
					jsx("option", { value: "text", children: t("node.outText") })
				] })] }),
				outType === "file" ? jsx("div", { className: "ws-field", children: [jsx("label", { children: t("node.outPath") }), jsx("input", { className: "ws-input", value: outPath, onChange: (e) => setOutPath(e.target.value), placeholder: "output/report.md" })] }) : null,
				outType === "text" ? jsx("div", { className: "ws-field", children: [jsx("label", { children: t("node.outTextLabel") }), jsx("textarea", { className: "ws-input", value: outText, onChange: (e) => setOutText(e.target.value) })] }) : null,
				jsxs("label", { className: "ws-field", style: { flexDirection: "row", alignItems: "center", gap: 8 }, children: [
					jsx("input", { type: "checkbox", checked: useLoop, onChange: (e) => setUseLoop(e.target.checked) }),
					jsx("span", { children: t("node.loopMode") })
				] }),
				useLoop ? jsxs("div", { className: "ws-row", children: [
					jsx("div", { className: "ws-field", children: [jsx("label", { children: t("node.threshold") }), jsx("input", { type: "number", className: "ws-input", min: 0, max: 1, step: 0.05, value: threshold, onChange: (e) => setThreshold(e.target.value) })] }),
					jsx("div", { className: "ws-field", children: [jsx("label", { children: t("node.maxAttempts") }), jsx("input", { type: "number", className: "ws-input", min: 1, max: 10, step: 1, value: maxAttempts, onChange: (e) => setMaxAttempts(e.target.value) })] })
				] }) : null,
				jsxs("div", { className: "ws-footRow", children: [
					jsx("button", { type: "button", className: "ws-btn ws-delBtn", onClick: () => { onDelete(node.id); onCancel(); }, children: t("node.deleteBtn") }),
					jsx("div", { style: { flex: 1 } }),
					jsx("button", { type: "button", className: "ws-btn", onClick: onCancel, children: t("cancel") }),
					jsx("button", { type: "button", className: "ws-btn primary", onClick: save, children: t("confirm") })
				] })
			] }) });
		}
		//#endregion

		//#region EdgeEditOverlay
		function EdgeEditOverlay({ t, edge, onSave, onDelete, onCancel }) {
			useDialogEscape(onCancel);
			const ed = edge.data || {};
			const [intent, setIntent] = react.useState(EDGE_INTENTS.indexOf(ed.intent) >= 0 ? ed.intent : "custom");
			const [label, setLabel] = react.useState(edge.label || "");
			const [threshold, setThreshold] = react.useState(String(ed.threshold != null ? ed.threshold : 0.7));
			const save = () => {
				onSave(edge.id, { intent, label: label || intentLabelLocal(t, intent), threshold: intent === "loop-gate" ? Number(threshold) || 0.7 : undefined });
				onCancel();
			};
			return jsx("div", { className: "ws-overlay", role: "dialog", "aria-modal": "true", onClick: (e) => { if (e.target === e.currentTarget) onCancel(); }, children: jsxs("div", { className: "ws-card", children: [
				jsx("h4", { children: t("edge.title") }),
				ed.detail ? jsx("div", { className: "ws-drawerHint", children: ed.detail }) : null,
				jsx("div", { className: "ws-field", children: [jsx("label", { children: t("edge.intent") }), jsx("select", { className: "ws-input", value: intent, onChange: (e) => setIntent(e.target.value), children: EDGE_INTENTS.map((k) => jsx("option", { value: k, key: k, children: intentLabelLocal(t, k) })) })] }),
				jsx("div", { className: "ws-field", children: [jsx("label", { children: t("edge.label") }), jsx("input", { className: "ws-input", value: label, onChange: (e) => setLabel(e.target.value) })] }),
				intent === "loop-gate" ? jsx("div", { className: "ws-field", children: [jsx("label", { children: t("edge.threshold") }), jsx("input", { type: "number", className: "ws-input", min: 0, max: 1, step: 0.05, value: threshold, onChange: (e) => setThreshold(e.target.value) })] }) : null,
				jsxs("div", { className: "ws-footRow", children: [
					jsx("button", { type: "button", className: "ws-btn ws-delBtn", onClick: () => { onDelete(edge.id); onCancel(); }, children: t("edge.delete") }),
					jsx("div", { style: { flex: 1 } }),
					jsx("button", { type: "button", className: "ws-btn", onClick: onCancel, children: t("cancel") }),
					jsx("button", { type: "button", className: "ws-btn primary", onClick: save, children: t("confirm") })
				] })
			] }) });
		}
		function intentLabelLocal(t, intent) {
			const m = { context: t("edge.ctx"), artifact: t("edge.artifact"), "prompt-inject": t("edge.promptInject"), "review-feedback": t("edge.reviewFeedback"), "loop-gate": t("edge.loopGate"), output: t("edge.output"), custom: t("edge.custom") };
			return m[intent] || t("edge.custom");
		}
		//#endregion

		//#region AgentFormOverlay
		function AgentFormOverlay({ t, existingIds, category, onSave, onCancel }) {
			useDialogEscape(onCancel);
			const [id, setId] = react.useState("");
			const [name, setName] = react.useState("");
			const [role, setRole] = react.useState(category || "action");
			const [prompt, setPrompt] = react.useState("");
			const [err, setErr] = react.useState("");
			const save = () => {
				const clean = id.trim();
				if (!clean) { setErr(t("agents.id")); return; }
				if (existingIds.indexOf(clean) >= 0) { setErr(t("agents.dup")); return; }
				onSave({ id: clean, name: name.trim() || clean, role: role.trim() || (category || "action"), prompt: prompt.trim(), category: category || "action" });
				onCancel();
			};
			return jsx("div", { className: "ws-overlay", role: "dialog", "aria-modal": "true", onClick: (e) => { if (e.target === e.currentTarget) onCancel(); }, children: jsxs("div", { className: "ws-card", children: [
				jsx("h4", { children: t("agents.add") + (category ? " · " + t("menu." + category) : "") }),
				jsx("div", { className: "ws-field", children: [jsx("label", { children: t("agents.id") }), jsx("input", { className: "ws-input", value: id, onChange: (e) => setId(e.target.value), placeholder: "agent.custom1" })] }),
				jsx("div", { className: "ws-row", children: [
					jsx("div", { className: "ws-field", children: [jsx("label", { children: t("agents.name") }), jsx("input", { className: "ws-input", value: name, onChange: (e) => setName(e.target.value) })] }),
					jsx("div", { className: "ws-field", children: [jsx("label", { children: t("agents.role") }), jsx("input", { className: "ws-input", value: role, onChange: (e) => setRole(e.target.value), placeholder: category || "action" })] })
				] }),
				jsx("div", { className: "ws-field", children: [jsx("label", { children: t("agents.prompt") }), jsx("textarea", { className: "ws-input", value: prompt, onChange: (e) => setPrompt(e.target.value) })] }),
				err ? jsx("div", { className: "ws-err", children: err }) : null,
				jsxs("div", { className: "ws-footRow", children: [
					jsx("div", { style: { flex: 1 } }),
					jsx("button", { type: "button", className: "ws-btn", onClick: onCancel, children: t("cancel") }),
					jsx("button", { type: "button", className: "ws-btn primary", onClick: save, children: t("confirm") })
				] })
			] }) });
		}
		//#endregion

		//#region GenPromptOverlay
		function GenPromptOverlay({ t, onGenerate, onCancel }) {
			useDialogEscape(onCancel);
			const [text, setText] = react.useState("");
			const [busy, setBusy] = react.useState(false);
			const [err, setErr] = react.useState("");
			const go = async () => {
				if (!text.trim() || busy) return;
				setBusy(true); setErr("");
				try { await onGenerate(text); } catch (e) { setErr(String(t("gen.fail")).split("{err}").join((e && e.message) || "")); }
				finally { setBusy(false); }
			};
			return jsx("div", { className: "ws-overlay", role: "dialog", "aria-modal": "true", onClick: (e) => { if (e.target === e.currentTarget) onCancel(); }, children: jsxs("div", { className: "ws-card", children: [
				jsx("h4", { children: t("chat.generate") }),
				jsx("div", { className: "ws-field", children: [jsx("label", { children: t("chat.title") }), jsx("textarea", { className: "ws-input", value: text, onChange: (e) => setText(e.target.value), onKeyDown: (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) go(); }, placeholder: t("chat.placeholder"), autoFocus: true })] }),
				jsx("div", { className: "ws-drawerHint", children: t("chat.empty") }),
				err ? jsx("div", { className: "ws-err", children: err }) : null,
				jsxs("div", { className: "ws-footRow", children: [
					jsx("div", { style: { flex: 1 } }),
					jsx("button", { type: "button", className: "ws-btn", onClick: onCancel, children: t("cancel") }),
					jsx("button", { type: "button", className: "ws-btn primary", onClick: go, disabled: !text.trim() || busy, children: busy ? t("loading") : t("confirm") })
				] })
			] }) });
		}
		//#endregion

		//#region animation (M5)
		// Close a dialog overlay on Escape (focus-trap-lite; Escape is the minimal a11y win).
		function useDialogEscape(onCancel) {
			react.useEffect(() => {
				if (typeof window === "undefined" || typeof onCancel !== "function") return;
				const onKey = (e) => { if (e.key === "Escape") onCancel(); };
				window.addEventListener("keydown", onKey);
				return () => window.removeEventListener("keydown", onKey);
			}, [onCancel]);
		}
		// Apple spring constants: emphasise 1/157.9/17.6 (~0.5s + bounce .3).
		// back.out(1.5) ≈ a single subtle overshoot — closest GSAP-native mapping.
		function prefersReducedMotion() {
			return typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		}
		function playNodeIn(el) {
			if (!window.gsap || !el) return;
			if (prefersReducedMotion()) { window.gsap.set(el, { opacity: 1, scale: 1, y: 0 }); return; }
			window.gsap.set(el, { transition: "none" });
			window.gsap.fromTo(el, { opacity: 0, scale: 0.9, y: 8 }, { opacity: 1, scale: 1, y: 0, duration: 0.45, ease: "back.out(1.5)", clearProps: "transform,transition" });
		}
		function flowEdge(el) {
			if (!el) return;
			el.classList.add("ws-edgeFlow");
			// Remove the idle "connection made" flow after one loop so finished graphs don't
			// animate forever (runtime active-edge flow is driven separately by ws-edgeActive).
			if (typeof window !== "undefined") window.setTimeout(() => { if (el.classList) el.classList.remove("ws-edgeFlow"); }, 1000);
		}
		//#endregion

		//#region settings
		function SettingsSection({ t }) {
			const [mode, setMode] = react.useState(pluginSettings.bubbleMode || "default");
			const update = (m) => { setMode(m); pluginSettings.bubbleMode = m; bubbleMode = m; };
			return jsxs("div", { style: { padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14, maxWidth: 480 }, children: [
				jsx("h3", { style: { margin: 0 }, children: t("title") }),
				jsxs("label", { style: { display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }, children: [
					jsx("span", { children: t("set.bubbleLabel") }),
					jsx("select", { value: mode, onChange: (e) => update(e.target.value), style: { fontSize: 13, padding: "6px 8px", borderRadius: 8 }, children: [
						jsx("option", { value: "default", children: t("set.bubbleDefault") }),
						jsx("option", { value: "float", children: t("set.bubbleFloat") })
					] })
				] })
			] });
		}
		//#endregion

		//#region index
		const inject = ["slots", "locale", "sessions"];
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "workflow-studio: dictionaries");
			const t = ctx.locale.bind(NS);
			ctx.slots.inject("conversation.view", () => ctx.slots.register({
				name: "conversation.view",
				id: "workflow",
				order: 20,
				locale: NS,
				label: () => t("view.workflow")
			}, (props) => jsx(WorkflowView, { t, sessionId: props.sessionId })));
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "workflow-studio",
				order: 60,
				locale: NS,
				label: () => t("title")
			}, (props) => jsx(SettingsSection, { t, close: props.close })));
		}
		//#endregion

		exports.NS = NS;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
};
window.__ModuleLoader__.load({ id: "@eave_bounty/dsh-workflow-studio", factory: dshWorkflowStudioFactory });
window.__ModuleLoader__.load({ id: "dsh-workflow-studio", factory: dshWorkflowStudioFactory });
