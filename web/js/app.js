/* ════════════════════════════════════════════════════════════════
   dsh-workflow-studio · web/js/app.js
   画布核心逻辑（零依赖，原生 JS + SVG）。

   核心理念：
   1. 用户绝不打字 —— 每个模块 / 每条连线的描述由大模型自动生成候选，
      用户只从候选中「点选」一个（推荐项标「推荐」）。
   2. 虚线只在运行后才出现（表示数据流动），平时用实线表示结构关系。

   可被 js/edges.js 扩展（全局接口见文件底部 window.__wf）：
   - window.__wfRun          ：运行入口（默认内置简易实现，edges.js 可覆盖增强）
   - window.__wfEdgeSemantic ：连线语义生成（默认调 /api/edge/semantic，可覆盖）
   - window.__wf.on(...)     ：订阅事件（node-added / edge-added / run-requested ...）
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── 常量 ─────────────────────────────────────────────── */
  var NODE_W = 224;
  var NODE_H = 92;
  var CONNECT_THRESHOLD = 26; // 连线吸附到目标入点的像素阈值
  var NS = 'http://www.w3.org/2000/svg';

  var KINDS = {
    root:    { label: '起点', color: '#0A84FF', icon: 'flag' },
    plan:    { label: '计划', color: '#FF9F0A', icon: 'clipboard' },
    action:  { label: '执行', color: '#34C759', icon: 'zap' },
    review:  { label: '审核', color: '#AF52DE', icon: 'shield' },
    loop:    { label: '循环', color: '#FF2D55', icon: 'refresh' },
    summary: { label: '汇总', color: '#32ADE6', icon: 'layers' }
  };

  var ICON_PATHS = {
    flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>',
    clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4M12 16h4M8 11h.01M8 16h.01"/>',
    zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
    refresh: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    layers: '<path d="m12 2 10 5-10 5L2 7l10-5z"/><path d="m2 12 10 5 10-5"/><path d="m2 17 10 5 10-5"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>'
  };
  function ic(name, cls) {
    return '<svg class="' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICON_PATHS[name] || '') + '</svg>';
  }

  /* 抽屉内各类型的初始模块模板（root/plan/action/review/loop/summary） */
  var TEMPLATES = {
    root: [
      { id: 'root-entry', title: '流程起点', description: '注入总体目标并启动流程。', prompt: '你是流程启动器：接收总体目标，输出清晰的起点上下文。', recommended: true }
    ],
    plan: [
      { id: 'plan-breakdown', title: '拆解计划', description: '把目标拆解为可分步执行、可分工的计划。', prompt: '你是产品/技术负责人：将目标拆解为清晰、可分步、可分工的执行计划，并给出每步的负责人与交付物。', recommended: true },
      { id: 'plan-research', title: '调研先行', description: '先做调研与事实收集，再制定计划。', prompt: '你是资深调研员：先收集事实与资料，再据此制定可执行的计划。', recommended: false },
      { id: 'plan-milestones', title: '里程碑规划', description: '规划关键里程碑与时间点。', prompt: '你是项目经理：为目标制定里程碑、依赖关系与验收标准。', recommended: false }
    ],
    action: [
      { id: 'action-execute', title: '执行任务', description: '执行任务并产出可用结果。', prompt: '你是执行者：按输入与计划，产出准确、可用、结构化的结果。', recommended: true },
      { id: 'action-verify', title: '执行并自检', description: '执行任务，并对结果做自检。', prompt: '你是执行者：完成任务后自检结果是否正确完整，必要时修正。', recommended: false },
      { id: 'action-draft', title: '草拟内容', description: '为任务草拟初稿内容。', prompt: '你是起草者：产出高质量初稿，供后续审核与完善。', recommended: false }
    ],
    review: [
      { id: 'review-check', title: '审核把关', description: '审核产出，检查正确性与完整性。', prompt: '你是审核员：检查产出的正确性、完整性与风险，给出可执行的改进意见。', recommended: true },
      { id: 'review-risk', title: '风险审查', description: '对产出做风险与边界审查。', prompt: '你是风控审核员：审视潜在风险、异常输入与边界情况。', recommended: false },
      { id: 'review-meta', title: '元审核', description: '检查已有的审核是否合理、有无遗漏维度。', prompt: '你是元审核员：检查已有的审核角度是否合理、是否遗漏关键维度。', recommended: false }
    ],
    loop: [
      { id: 'loop-container', title: '循环体', description: '反复执行内部内容直至满足收敛条件。', prompt: '你是循环体：重复执行内部子图，直到达到放行阈值或最大次数。', recommended: true },
      { id: 'loop-iterate', title: '迭代优化', description: '对产出反复迭代打磨直至满意。', prompt: '你是迭代器：持续优化结果，直到质量达标。', recommended: false }
    ],
    summary: [
      { id: 'summary-aggregate', title: '汇总产出', description: '聚合上游各分支产出，形成结构化结论。', prompt: '你是分析师：聚合上游产出，提炼结构化结论与建议。', recommended: true }
    ]
  };
  var FALLBACK_CANDIDATES = TEMPLATES; // 离线 / 未配置时的候选（后端同源模板）

  /* 抽屉分节：哪个按钮打开哪些类型。起点（root）不在此列——起点由系统自动放置且唯一，用户不能从抽屉拖出第二个起点。 */
  var DRAWER_MAP = {
    plan:   [ { label: '计划', kind: 'plan' } ],
    action: [ { label: '执行', kind: 'action' } ],
    review: [ { label: '审核', kind: 'review' } ],
    loop:   [ { label: '循环', kind: 'loop' }, { label: '汇总', kind: 'summary' } ]
  };

  /* ── 状态 ─────────────────────────────────────────────── */
  var state = {
    nodes: [],
    edges: [],
    selectedNodeId: null,
    selectedEdgeId: null,
    runState: false,
    drawerOpen: null,
    nextId: 1,
    flowId: null,
    flowName: '未命名流程'
  };
  var cachedSettings = null;
  var pickerState = { nodeId: null, fallback: false };
  var listeners = {};

  var el = {};

  /* ── 工具 ─────────────────────────────────────────────── */
  function uid(prefix) {
    return prefix + '-' + (state.nextId++) + '-' + Date.now().toString(36);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function getNode(id) {
    for (var i = 0; i < state.nodes.length; i++) if (state.nodes[i].id === id) return state.nodes[i];
    return null;
  }
  function getEdge(id) {
    for (var i = 0; i < state.edges.length; i++) if (state.edges[i].id === id) return state.edges[i];
    return null;
  }

  function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', headers: { 'Content-Type': 'application/json' } };
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
    return fetch(path, init).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: '响应解析失败' }; }).then(function (d) {
        if (!r.ok) {
          var e = new Error(d.error || d.detail || ('HTTP ' + r.status));
          e.data = d;
          throw e;
        }
        return d;
      });
    });
  }

  function toast(msg, type) {
    type = type || 'info';
    var t = document.createElement('div');
    t.className = 'toast toast-' + type;
    t.innerHTML = '<span class="toast-dot"></span><span>' + esc(msg) + '</span>';
    el.toasts.appendChild(t);
    var dur = (type === 'error') ? 5200 : 3400;
    setTimeout(function () {
      t.classList.add('leaving');
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 280);
    }, dur);
  }

  /* ── 事件总线 ─────────────────────────────────────────── */
  function on(name, cb) { (listeners[name] = listeners[name] || []).push(cb); }
  function emit(name, data) {
    (listeners[name] || []).slice().forEach(function (cb) {
      try { cb(data); } catch (e) { /* 订阅方异常不影响主流程 */ }
    });
  }

  /* ── 坐标 ─────────────────────────────────────────────── */
  function clientToCanvas(cx, cy) {
    var rect = el.canvas.getBoundingClientRect();
    return { x: cx - rect.left, y: cy - rect.top };
  }
  function portPos(node, side) {
    var x = node.x + (side === 'out' ? NODE_W : 0);
    var y = node.y + NODE_H / 2;
    return { x: x, y: y };
  }
  function bezierPath(p1, p2) {
    var dx = Math.max(40, Math.min(220, Math.abs(p2.x - p1.x) / 2));
    return 'M' + p1.x + ',' + p1.y +
           ' C' + (p1.x + dx) + ',' + p1.y +
           ' ' + (p2.x - dx) + ',' + p2.y +
           ' ' + p2.x + ',' + p2.y;
  }
  function bezierMid(p1, p2) {
    var dx = Math.max(40, Math.min(220, Math.abs(p2.x - p1.x) / 2));
    return {
      x: (p1.x + 3 * (p1.x + dx) + 3 * (p2.x - dx) + p2.x) / 8,
      y: (p1.y + 3 * p1.y + 3 * p2.y + p2.y) / 8
    };
  }

  /* ── 渲染：节点 ───────────────────────────────────────── */
  function nodeHTML(node) {
    var k = KINDS[node.kind] || KINDS.action;
    var selected = (node.id === state.selectedNodeId) ? ' selected' : '';
    var body = '';
    if (node.kind === 'root') {
      // 起点：必须填写全局目标（goal），填完才允许拖入其它模块
      body = '<span class="wf-node-desc">' + esc(node.description || '流程起点 · 请填写全局目标') + '</span>' +
             '<div class="wf-goal-row">' +
             '<label class="wf-goal-label" for="goal-' + node.id + '">目标</label>' +
             '<input class="wf-goal-input" id="goal-' + node.id + '" data-goal="' + node.id +
             '" value="' + esc(node.goal || '') + '" placeholder="本项目要做什么？" spellcheck="false" />' +
             '</div>' +
             (node.goal ? '' : '<span class="wf-goal-hint">填写目标后才能拖入其它模块</span>');
    } else if (node.status === 'generating') {
      body = '<span class="wf-node-spinner"></span><span class="wf-node-gen">生成中…</span>';
    } else if (node.run) {
      body = '<span class="wf-node-run run-' + (node.run.status || 'done') + '">' + runChipHTML(node.run) + '</span>';
    } else {
      body = '<span class="wf-node-desc">' + esc(node.description || '（暂无描述）') + '</span>';
    }
    return '<div class="wf-node kind-' + node.kind + selected + '" data-id="' + node.id +
           '" style="transform:translate(' + node.x + 'px,' + node.y + 'px)">' +
           '<span class="wf-port port-in" title="上游输入"></span>' +
           '<span class="wf-port port-out" title="拖出连线到下游"></span>' +
           '<div class="wf-node-head">' +
           '<span class="wf-node-icon">' + ic(k.icon) + '</span>' +
           '<span class="wf-node-title">' + esc(node.title) + '</span>' +
           '<span class="wf-node-kind">' + k.label + '</span>' +
           '</div>' +
           '<div class="wf-node-body">' + body + '</div>' +
           '<div class="wf-node-actions">' +
           '<button class="node-action node-action--regen" data-act="regen" title="重新生成候选">' + ic('refresh') + '</button>' +
           '<button class="node-action node-action--del" data-act="del" title="删除模块">' + ic('trash') + '</button>' +
           '</div></div>';
  }

  function runChipHTML(run) {
    if (run.status === 'running') return '<span class="wf-node-spinner"></span> 运行中…';
    if (run.status === 'error') return '✗ ' + esc(run.summary || '出错');
    var score = (typeof run.score === 'number') ? (' · 评分 ' + run.score) : '';
    return '✓ ' + esc(run.summary || '完成') + score;
  }

  function renderNodes() {
    el.nodesLayer.innerHTML = state.nodes.map(nodeHTML).join('');
    var hint = el.canvasHint;
    if (hint) hint.classList.toggle('hidden', state.nodes.length > 0);
  }

  /* ── 渲染：连线 ───────────────────────────────────────── */
  function buildDefs() {
    var defs = document.createElementNS(NS, 'defs');
    Object.keys(KINDS).forEach(function (k) {
      var m = document.createElementNS(NS, 'marker');
      m.setAttribute('id', 'arr-' + k);
      m.setAttribute('viewBox', '0 0 10 10');
      m.setAttribute('refX', '9');
      m.setAttribute('refY', '5');
      m.setAttribute('markerWidth', '7');
      m.setAttribute('markerHeight', '7');
      m.setAttribute('markerUnits', 'userSpaceOnUse');
      m.setAttribute('orient', 'auto');
      var p = document.createElementNS(NS, 'path');
      p.setAttribute('d', 'M0,0 L10,5 L0,10 z');
      p.setAttribute('fill', KINDS[k].color);
      m.appendChild(p);
      defs.appendChild(m);
    });
    el.edgeSvg.appendChild(defs);
    // 临时连线（拖拽连接时显示；独立 class，避免被 updateEdges 清理）
    var temp = document.createElementNS(NS, 'path');
    temp.setAttribute('id', 'temp-edge');
    temp.setAttribute('class', 'wf-edge-temp');
    temp.setAttribute('fill', 'none');
    temp.style.display = 'none';
    el.edgeSvg.appendChild(temp);
    el.tempEdge = temp;
  }

  function updateEdges() {
    var svg = el.edgeSvg;
    var old = svg.querySelectorAll('.wf-edge, .wf-edge-hit');
    for (var i = 0; i < old.length; i++) old[i].parentNode.removeChild(old[i]);
    el.edgeLabels.innerHTML = '';

    state.edges.forEach(function (e) {
      var src = getNode(e.source), tgt = getNode(e.target);
      if (!src || !tgt) return;
      var p1 = portPos(src, 'out'), p2 = portPos(tgt, 'in');
      var d = bezierPath(p1, p2);
      var color = (KINDS[src.kind] || KINDS.action).color;
      var sel = (e.id === state.selectedEdgeId);

      var path = document.createElementNS(NS, 'path');
      path.setAttribute('d', d);
      path.setAttribute('class', 'wf-edge' + (sel ? ' selected' : ''));
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', color);
      path.setAttribute('stroke-opacity', sel ? '1' : '0.72');
      path.setAttribute('stroke-width', sel ? '3' : '2');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('marker-end', 'url(#arr-' + src.kind + ')');
      svg.appendChild(path);

      var hit = document.createElementNS(NS, 'path');
      hit.setAttribute('d', d);
      hit.setAttribute('class', 'wf-edge-hit');
      hit.setAttribute('fill', 'none');
      hit.setAttribute('stroke', 'transparent');
      hit.setAttribute('stroke-width', '16');
      hit.setAttribute('data-edge', e.id);
      svg.appendChild(hit);

      var text = e.data && (e.data.label || (e.data.pending ? '生成中…' : ''));
      if (text) {
        var m = bezierMid(p1, p2);
        var lab = document.createElement('div');
        lab.className = 'wf-edge-label' + (sel ? ' selected' : '');
        lab.setAttribute('data-edge', e.id);
        lab.textContent = text;
        lab.title = text;
        lab.style.left = m.x + 'px';
        lab.style.top = m.y + 'px';
        lab.style.setProperty('--el', color);
        el.edgeLabels.appendChild(lab);
      }
    });
  }

  function renderEdges() { updateEdges(); }

  /* ── 选择 ─────────────────────────────────────────────── */
  function selectNode(id) {
    state.selectedNodeId = id;
    state.selectedEdgeId = null;
    applySelectionClasses();
    renderPanel();
    emit('node-selected', getNode(id));
  }
  function selectEdge(id) {
    state.selectedEdgeId = id;
    state.selectedNodeId = null;
    applySelectionClasses();
    updateEdges();
    renderPanel();
    emit('edge-selected', getEdge(id));
  }
  function deselectAll() {
    state.selectedNodeId = null;
    state.selectedEdgeId = null;
    applySelectionClasses();
    updateEdges();
    renderPanel();
    emit('selection-cleared', null);
  }
  function applySelectionClasses() {
    var list = el.nodesLayer.querySelectorAll('.wf-node');
    for (var i = 0; i < list.length; i++) {
      var n = list[i];
      var on = (n.getAttribute('data-id') === state.selectedNodeId);
      n.classList.toggle('selected', on);
    }
  }

  /* ── 起点 / 目标守卫 ─────────────────────────────────── */
  function rootNode() {
    for (var i = 0; i < state.nodes.length; i++) if (state.nodes[i].kind === 'root') return state.nodes[i];
    return null;
  }
  function hasGoal() {
    var r = rootNode();
    return !!r && !!String(r.goal || '').trim();
  }
  // 是否允许添加一个非起点模块（必须已有起点且已填目标）
  function canAddModule() {
    if (!rootNode()) return false;
    return hasGoal();
  }
  // 首次进入：若无任何节点，自动放置唯一起点
  function ensureRootIfEmpty() {
    if (state.nodes.length === 0) {
      var node = {
        id: uid('root'),
        kind: 'root',
        title: '流程起点',
        description: '注入总体目标并启动流程。',
        prompt: '你是流程启动器：接收总体目标，输出清晰的起点上下文。',
        goal: '',
        recommended: true,
        x: 260 - NODE_W / 2,
        y: 180 - NODE_H / 2,
        status: 'ready'
      };
      state.nodes.push(node);
      renderNodes();
      updateEdges();
      selectNode(node.id);
    }
  }

  /* ── 节点操作 ─────────────────────────────────────────── */
  function addNode(kind, tmpl, x, y) {
    tmpl = tmpl || {};
    // 起点唯一：已有起点则禁止再创建
    if (kind === 'root') {
      if (rootNode()) { toast('起点已存在，只能有一个起点', 'error'); return null; }
      // 允许创建起点（首次/恢复时）
      var rnode = {
        id: uid('root'),
        kind: 'root',
        title: '流程起点',
        description: tmpl.description || '注入总体目标并启动流程。',
        prompt: tmpl.prompt || '',
        goal: '',
        recommended: !!tmpl.recommended,
        x: Math.round(x),
        y: Math.round(y),
        status: 'ready'
      };
      state.nodes.push(rnode);
      renderNodes();
      updateEdges();
      emit('node-added', rnode);
      selectNode(rnode.id);
      return rnode;
    }
    // 非起点模块：必须先有起点且已填目标
    if (!hasGoal()) {
      toast('请先在起点填写「目标」，再拖入其它模块', 'error');
      ensureRootIfEmpty();
      selectNode(rootNode() && rootNode().id);
      return null;
    }
    var node = {
      id: uid('node'),
      kind: kind,
      title: tmpl.title || '模块',
      description: tmpl.description || '',
      prompt: tmpl.prompt || '',
      recommended: !!tmpl.recommended,
      x: Math.round(x),
      y: Math.round(y),
      status: 'ready' // generateForNode 会立即置为 generating 并触发候选生成
    };
    state.nodes.push(node);
    renderNodes();
    emit('node-added', node);
    selectNode(node.id);
    generateForNode(node);
    return node;
  }

  function removeNode(id) {
    var node = getNode(id);
    if (!node) return;
    state.nodes = state.nodes.filter(function (n) { return n.id !== id; });
    state.edges = state.edges.filter(function (e) { return e.source !== id && e.target !== id; });
    if (state.selectedNodeId === id) state.selectedNodeId = null;
    if (state.selectedEdgeId && !getEdge(state.selectedEdgeId)) state.selectedEdgeId = null;
    renderNodes();
    updateEdges();
    renderPanel();
    emit('node-removed', node);
  }

  /* 生成上下文：plan（全局目标 root.goal 优先，其次最近的 plan 祖先）+ upstream（直接上游标题列表） */
  function buildGenCtx(node) {
    var upstreamTitles = [];
    var stack = [];
    state.edges.forEach(function (e) {
      if (e.target === node.id) {
        var n = getNode(e.source);
        if (n) { upstreamTitles.push(n.title); stack.push(e.source); }
      }
    });
    var r = rootNode();
    var plan = (r && String(r.goal || '').trim()) || '';
    var seen = {};
    while (stack.length) {
      var id = stack.shift();
      if (seen[id]) continue;
      seen[id] = true;
      var n = getNode(id);
      if (!n) continue;
      if ((n.kind === 'plan' || n.kind === 'root') && !plan) { plan = n.goal || n.title; break; }
      state.edges.forEach(function (e) { if (e.target === id) stack.push(e.source); });
    }
    return { plan: plan, upstream: upstreamTitles };
  }

  function generateForNode(node) {
    if (!node || node.status === 'generating') return;
    node.status = 'generating';
    renderNodes();

    var fallback = function () {
      var n = getNode(node.id);
      if (!n || n.status !== 'generating') return;
      toast('未配置模型或连接失败，已用内置模板', 'info');
      showPicker(node, (TEMPLATES[node.kind] || TEMPLATES.action).slice(), true);
    };

    api('/api/module/generate', {
      method: 'POST',
      body: { kind: node.kind, ctx: buildGenCtx(node) }
    }).then(function (d) {
      var n = getNode(node.id);
      if (!n || n.status !== 'generating') return;
      var cands = Array.isArray(d.candidates) ? d.candidates : [];
      if (!cands.length) { fallback(); return; }
      showPicker(node, cands, false);
    }).catch(function () {
      var n = getNode(node.id);
      if (!n || n.status !== 'generating') return;
      fallback();
    });
  }

  function applyCandidate(node, cand) {
    node.title = cand.title || node.title;
    node.description = cand.description || '';
    node.prompt = cand.prompt || '';
    node.recommended = !!cand.recommended;
    node.status = 'ready';
    renderNodes();
    updateEdges();
    emit('node-updated', node);
    refreshConnectedEdges(node);
    toast('已应用「' + node.title + '」', node.recommended ? 'success' : 'info');
  }

  /* 节点标题变化后，刷新相连连线的语义 */
  function refreshConnectedEdges(node) {
    state.edges.forEach(function (e) {
      if (e.source === node.id || e.target === node.id) updateEdgeSemantics(e);
    });
  }

  /* ── 连线语义 ─────────────────────────────────────────── */
  function defaultEdgeSemantic(src, tgt) {
    return api('/api/edge/semantic', {
      method: 'POST',
      body: {
        from_module: { kind: src.kind, title: src.title },
        to_module: { kind: tgt.kind, title: tgt.title }
      }
    }).then(function (d) {
      return { intent: d.intent, label: d.label, description: d.description, injection: d.injection };
    }).catch(function () {
      return {
        intent: 'context',
        label: src.title + ' → ' + tgt.title,
        description: '（离线）' + src.title + ' 的产出作为 ' + tgt.title + ' 的上游输入，两者结合形成连贯流程。',
        injection: '将 ' + src.title + ' 的输出注入 ' + tgt.title + ' 的 Agent 提示词，作为其上游上下文。'
      };
    });
  }

  function updateEdgeSemantics(edge) {
    var src = getNode(edge.source), tgt = getNode(edge.target);
    if (!src || !tgt) return;
    edge.data = edge.data || {};
    edge.data.pending = true;
    updateEdges();

    var impl = window.__wfEdgeSemantic;
    var promise = (typeof impl === 'function')
      ? Promise.resolve(impl(src, tgt, edge))
      : defaultEdgeSemantic(src, tgt);

    promise.then(function (sem) {
      var e = getEdge(edge.id);
      if (!e) return;
      e.data.pending = false;
      if (sem && sem.label) {
        e.data.intent = sem.intent || 'context';
        e.data.label = sem.label;
        e.data.description = sem.description || '';
        e.data.injection = sem.injection || '';
      }
      updateEdges();
      if (state.selectedEdgeId === e.id) renderPanel();
      emit('edge-updated', e);
    }).catch(function () {
      var e = getEdge(edge.id);
      if (e) { e.data.pending = false; updateEdges(); }
    });
  }

  function addEdge(sourceId, targetId) {
    if (sourceId === targetId) return null;
    var dup = null;
    state.edges.forEach(function (e) {
      if (e.source === sourceId && e.target === targetId) dup = e;
    });
    if (dup) { selectEdge(dup.id); return dup; }
    var edge = { id: uid('edge'), source: sourceId, target: targetId, data: {} };
    state.edges.push(edge);
    updateEdges();
    emit('edge-added', edge);
    selectEdge(edge.id);
    updateEdgeSemantics(edge);
    return edge;
  }

  function removeEdge(id) {
    var edge = getEdge(id);
    if (!edge) return;
    state.edges = state.edges.filter(function (e) { return e.id !== id; });
    if (state.selectedEdgeId === id) state.selectedEdgeId = null;
    updateEdges();
    renderPanel();
    emit('edge-removed', edge);
  }

  /* ── 候选选择弹层 ─────────────────────────────────────── */
  function showPicker(node, candidates, fallback) {
    closePicker(true);
    pickerState.nodeId = node.id;
    pickerState.fallback = !!fallback;

    el.pickerNote.classList.toggle('hidden', !fallback);
    if (fallback) {
      el.pickerNote.textContent = '模型未配置或离线，已展示内置模板候选，仍可直接点选使用。';
    }
    var k = KINDS[node.kind] || KINDS.action;
    el.pickerTitle.textContent = k.label + '模块 · 选择描述';

    el.pickerList.innerHTML = '';
    candidates.forEach(function (c) {
      var item = document.createElement('div');
      item.className = 'cand' + (c.recommended ? ' cand--recommended' : '');
      var badge = c.recommended ? '<span class="cand-badge">推荐</span>' : '';
      item.innerHTML = '<div class="cand-title">' + esc(c.title) + badge + '</div>' +
                       '<div class="cand-desc">' + esc(c.description || '') + '</div>';
      item.addEventListener('click', function () {
        var n = getNode(pickerState.nodeId);
        if (n) applyCandidate(n, c);
        closePicker(false);
      });
      el.pickerList.appendChild(item);
    });
    el.pickerOverlay.classList.remove('hidden');
  }

  function closePicker(keepGenerating) {
    el.pickerOverlay.classList.add('hidden');
    if (!keepGenerating && pickerState.nodeId) {
      var n = getNode(pickerState.nodeId);
      if (n && n.status === 'generating') {
        n.status = 'ready';
        renderNodes();
        toast('已使用初始模板，可点击节点重新生成', 'info');
      }
    }
    pickerState.nodeId = null;
    pickerState.fallback = false;
  }

  /* ── 拖拽：节点移动 ───────────────────────────────────── */
  function startDragNode(id, e) {
    var node = getNode(id);
    if (!node) return;
    e.preventDefault();
    selectNode(id);
    var startX = e.clientX, startY = e.clientY;
    var ox = node.x, oy = node.y;
    var moved = false;
    var raf = 0;

    var move = function (ev) {
      var dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (!moved && Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      if (!moved) return;
      var nx = Math.round(ox + dx), ny = Math.round(oy + dy);
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(function () {
        node.x = nx; node.y = ny;
        var dom = el.nodesLayer.querySelector('.wf-node[data-id="' + id + '"]');
        if (dom) dom.style.transform = 'translate(' + nx + 'px,' + ny + 'px)';
        updateEdges();
      });
    };
    var up = function () {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (raf) cancelAnimationFrame(raf);
      el.canvasWrap.classList.remove('dragging-node');
      if (!moved) { selectNode(id); return; }
      emit('node-moved', node);
    };
    el.canvasWrap.classList.add('dragging-node');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  /* ── 拖拽：连接端口 ───────────────────────────────────── */
  function startConnect(node, e) {
    e.preventDefault();
    var p1 = portPos(node, 'out');
    var color = (KINDS[node.kind] || KINDS.action).color;
    el.tempEdge.setAttribute('d', bezierPath(p1, p1));
    el.tempEdge.setAttribute('stroke', color);
    el.tempEdge.setAttribute('stroke-opacity', '0.8');
    el.tempEdge.setAttribute('stroke-width', '2');
    el.tempEdge.setAttribute('marker-end', 'url(#arr-' + node.kind + ')');
    el.tempEdge.style.display = '';

    var move = function (ev) {
      var pt = clientToCanvas(ev.clientX, ev.clientY);
      el.tempEdge.setAttribute('d', bezierPath(p1, pt));
    };
    var up = function (ev) {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      el.tempEdge.style.display = 'none';
      var pt = clientToCanvas(ev.clientX, ev.clientY);
      var target = null, best = CONNECT_THRESHOLD;
      state.nodes.forEach(function (n) {
        if (n.id === node.id) return;
        var pos = portPos(n, 'in');
        var d = Math.hypot(pos.x - pt.x, pos.y - pt.y);
        if (d < best) { best = d; target = n; }
      });
      if (target) addEdge(node.id, target.id);
      else selectNode(node.id);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  /* ── 拖拽：抽屉模板 → 画布 ────────────────────────────── */
  function startTmplDrag(tmpl, e) {
    e.preventDefault();
    var ghost = document.createElement('div');
    ghost.className = 'wf-ghost';
    ghost.style.setProperty('--tkind', (KINDS[tmpl.kind] || KINDS.action).color);
    ghost.innerHTML = '<span class="wf-ghost-icon">' + ic(KINDS[tmpl.kind].icon) + '</span>' +
                      '<span class="wf-ghost-title">' + esc(tmpl.title) + '</span>';
    document.body.appendChild(ghost);

    var move = function (ev) {
      ghost.style.left = ev.clientX + 'px';
      ghost.style.top = ev.clientY + 'px';
    };
    var up = function (ev) {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      ghost.parentNode.removeChild(ghost);
      el.dropHint.classList.add('hidden');
      var rect = el.canvas.getBoundingClientRect();
      if (ev.clientX >= rect.left && ev.clientX <= rect.right &&
          ev.clientY >= rect.top && ev.clientY <= rect.bottom) {
        var pt = clientToCanvas(ev.clientX, ev.clientY);
        addNode(tmpl.kind, tmpl, pt.x - NODE_W / 2, pt.y - NODE_H / 2);
      }
    };
    ghost.style.left = e.clientX + 'px';
    ghost.style.top = e.clientY + 'px';
    el.dropHint.classList.remove('hidden');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  /* ── 抽屉 ─────────────────────────────────────────────── */
  function openDrawer(kind) {
    state.drawerOpen = kind;
    el.drawer.classList.remove('closed');
    el.drawer.style.setProperty('--kind', (KINDS[kind] || KINDS.action).color);
    el.drawerTitle.textContent = (KINDS[kind] || KINDS.action).label + '模块';
    var btns = document.querySelectorAll('.rail-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active', btns[i].getAttribute('data-kind') === kind);
    }
    el.drawerBody.innerHTML = '';
    (DRAWER_MAP[kind] || []).forEach(function (sec) {
      var h = document.createElement('div');
      h.className = 'drawer-sec';
      h.textContent = sec.label;
      el.drawerBody.appendChild(h);
      (TEMPLATES[sec.kind] || []).forEach(function (t) {
        var item = document.createElement('div');
        item.className = 'tmpl';
        item.style.setProperty('--tkind', (KINDS[sec.kind] || KINDS.action).color);
        item.innerHTML = '<span class="tmpl-icon">' + ic(KINDS[sec.kind].icon) + '</span>' +
                         '<div class="tmpl-info"><div class="tmpl-title">' + esc(t.title) + '</div>' +
                         '<div class="tmpl-desc">' + esc(t.description) + '</div></div>';
        item.addEventListener('pointerdown', function (ev) {
          startTmplDrag({ kind: sec.kind, title: t.title, description: t.description, prompt: t.prompt, recommended: t.recommended }, ev);
        });
        el.drawerBody.appendChild(item);
      });
    });
  }
  function closeDrawer() {
    state.drawerOpen = null;
    el.drawer.classList.add('closed');
    var btns = document.querySelectorAll('.rail-btn');
    for (var i = 0; i < btns.length; i++) btns[i].classList.remove('active');
  }
  function toggleDrawer(kind) {
    if (!kind) { closeDrawer(); return; }
    if (state.drawerOpen === kind) closeDrawer();
    else openDrawer(kind);
  }

  /* ── 信息面板 ─────────────────────────────────────────── */
  function renderPanel() {
    el.panelEmpty.classList.toggle('hidden', !!(state.selectedNodeId || state.selectedEdgeId));
    el.panelNode.classList.add('hidden');
    el.panelEdge.classList.add('hidden');
    var n = state.selectedNodeId ? getNode(state.selectedNodeId) : null;
    var ed = state.selectedEdgeId ? getEdge(state.selectedEdgeId) : null;
    if (n) renderNodePanel(n);
    else if (ed) renderEdgePanel(ed);
  }

  function renderNodePanel(n) {
    var k = KINDS[n.kind] || KINDS.action;
    var regen = (n.status === 'generating')
      ? '<button class="pbtn" disabled>生成中…</button>'
      : '<button class="pbtn pbtn-primary" data-pact="regen">' + ic('refresh') + '重新生成</button>';
    el.panelNode.innerHTML =
      '<div class="panel-head">' +
      '<span class="pn-kind" style="--kind:' + k.color + ';--kind-bg:rgba(' + hexToRgb(k.color) + ',.12)">' + k.label + '</span>' +
      '<div class="pn-title">' + esc(n.title) + '</div>' +
      '</div>' +
      '<div class="panel-scroll">' +
      '<div class="kv"><span class="k">描述</span><span class="v">' + esc(n.description || '—') + '</span></div>' +
      '<div class="kv"><span class="k">Agent 提示词</span><span class="v code">' + esc(n.prompt || '—') + '</span></div>' +
      '<div class="kv"><span class="k">推荐</span><span class="v">' + (n.recommended ? '是（模型推荐此项）' : '—') + '</span></div>' +
      '</div>' +
      '<div class="panel-actions">' + regen +
      '<button class="pbtn pbtn-danger" data-pact="del">' + ic('trash') + '删除</button>' +
      '</div>';
    el.panelNode.classList.remove('hidden');
  }

  function renderEdgePanel(ed) {
    var src = getNode(ed.source), tgt = getNode(ed.target);
    var data = ed.data || {};
    el.panelEdge.innerHTML =
      '<div class="panel-head"><h3>连线语义</h3></div>' +
      '<div class="panel-scroll">' +
      '<div class="kv"><span class="k">连接</span><span class="v">' + esc(src ? src.title : '?') + ' → ' + esc(tgt ? tgt.title : '?') + '</span></div>' +
      '<div class="kv"><span class="k">标签</span><span class="v">' + esc(data.label || (data.pending ? '生成中…' : '—')) + '</span></div>' +
      '<div class="kv"><span class="k">意图</span><span class="v">' + esc(data.intent || '—') + '</span></div>' +
      '<div class="kv"><span class="k">说明</span><span class="v">' + esc(data.description || '—') + '</span></div>' +
      '<div class="kv"><span class="k">注入方式</span><span class="v">' + esc(data.injection || '—') + '</span></div>' +
      '</div>' +
      '<div class="panel-actions">' +
      '<button class="pbtn pbtn-danger" data-pact="del-edge">' + ic('trash') + '删除连线</button>' +
      '</div>';
    el.panelEdge.classList.remove('hidden');
  }

  function hexToRgb(hex) {
    var h = hex.replace('#', '');
    var n = parseInt(h, 16);
    return (n >> 16) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255);
  }

  /* ── 设置 ─────────────────────────────────────────────── */
  function openSettings() {
    fillSettingsForm();
    el.settingsOverlay.classList.remove('hidden');
  }
  function closeSettings() {
    el.settingsOverlay.classList.add('hidden');
  }
  function fillSettingsForm() {
    if (!cachedSettings) return;
    el.setProvider.value = cachedSettings.provider || 'openai';
    el.setBaseUrl.value = cachedSettings.base_url || '';
    el.setModel.value = cachedSettings.model || '';
    el.setApiKey.value = '';
    el.setApiKey.placeholder = cachedSettings.has_key ? '已保存密钥，留空保持不变' : 'sk-…';
    onProviderChange();
  }
  function onProviderChange() {
    var hints = {
      openai: { base: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
      deepseek: { base: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
      'openai-compatible': { base: 'https://your-endpoint.example.com/v1', model: '' }
    };
    var h = hints[el.setProvider.value] || hints['openai-compatible'];
    el.setBaseUrl.placeholder = h.base;
    el.setModel.placeholder = h.model || '例如 gpt-4o-mini';
    if (!el.setBaseUrl.value.trim() && (!cachedSettings || !cachedSettings.base_url)) {
      el.setBaseUrl.value = h.base;
    }
  }
  function collectSettingsPayload() {
    var payload = {
      provider: el.setProvider.value,
      base_url: el.setBaseUrl.value.trim(),
      model: el.setModel.value.trim()
    };
    var key = el.setApiKey.value.trim();
    if (key) payload.api_key = key;
    else if (!(cachedSettings && cachedSettings.has_key)) payload.api_key = '';
    return payload;
  }
  function updateBadge(on) {
    el.configBadge.classList.toggle('badge-on', !!on);
    el.configBadge.classList.toggle('badge-off', !on);
    el.configBadgeText.textContent = on ? '已配置模型' : '未配置模型';
  }
  function refreshConfigBadge() {
    return api('/api/settings').then(function (d) {
      cachedSettings = d.settings || cachedSettings || null;
      updateBadge(!!(cachedSettings && cachedSettings.has_key && cachedSettings.model));
      return cachedSettings;
    }).catch(function () {
      updateBadge(false);
      return null;
    });
  }
  async function saveSettings() {
    var payload = collectSettingsPayload();
    var d = await api('/api/settings', { method: 'PUT', body: payload });
    cachedSettings = d.settings || cachedSettings;
    updateBadge(!!(d.configured || (cachedSettings && cachedSettings.has_key && cachedSettings.model)));
    return d;
  }
  async function testSettings() {
    if (!el.setModel.value.trim()) { toast('请先填写模型名称', 'warn'); return; }
    if (!el.setApiKey.value.trim() && !(cachedSettings && cachedSettings.has_key)) {
      toast('请先填写 API Key', 'warn'); return;
    }
    try {
      await saveSettings();
      toast('正在测试连接…', 'info');
      var d = await api('/api/settings/test', { method: 'POST' });
      toast('连接成功：' + (d.reply || 'OK'), 'success');
    } catch (e) {
      toast('连接失败：' + e.message, 'error');
    }
  }

  /* ── 保存 / 加载 ──────────────────────────────────────── */
  function serialize() {
    return {
      id: state.flowId || '',
      name: state.flowName || '未命名流程',
      nodes: state.nodes.map(function (n) {
        return {
          id: n.id, kind: n.kind, title: n.title,
          description: n.description || '', prompt: n.prompt || '',
          goal: n.kind === 'root' ? (n.goal || '') : undefined,
          x: Math.round(n.x), y: Math.round(n.y)
        };
      }),
      edges: state.edges.map(function (e) {
        return { id: e.id, source: e.source, target: e.target, data: e.data || {} };
      })
    };
  }
  async function saveCanvas() {
    if (!state.nodes.length) { toast('画布为空，先拖入模块', 'warn'); return null; }
    var d = await api('/api/flows', { method: 'POST', body: serialize() });
    if (d.ok) {
      state.flowId = d.id;
      try { localStorage.setItem('wf:lastFlowId', d.id); } catch (err) { /* 忽略 */ }
      toast('画布已保存：' + d.id, 'success');
      emit('canvas-saved', d);
      return d;
    }
    toast('保存失败', 'error');
    return null;
  }
  function renderFlow(flow) {
    state.nodes = (flow.nodes || []).map(function (n) {
      return {
        id: n.id, kind: n.kind || 'action', title: n.title || '模块',
        description: n.description || '', prompt: n.prompt || '',
        goal: (n.kind === 'root') ? (n.goal || '') : undefined,
        recommended: !!n.recommended,
        x: Number(n.x) || 80, y: Number(n.y) || 80,
        status: 'ready'
      };
    });
    state.edges = (flow.edges || []).map(function (e) {
      return { id: e.id, source: e.source, target: e.target, data: e.data || {} };
    });
    state.flowId = flow.id || null;
    state.flowName = flow.name || flow.id || '未命名流程';
    el.flowName.textContent = state.flowName;
    renderNodes();
    updateEdges();
    renderPanel();
    emit('flow-loaded', flow);
  }
  async function loadLastFlow() {
    try {
      var d = await api('/api/flows');
      var flows = d.flows || [];
      if (!flows.length) return;
      var id = null;
      try { id = localStorage.getItem('wf:lastFlowId'); } catch (err) { /* 忽略 */ }
      var pick = null;
      for (var i = 0; i < flows.length; i++) if (flows[i].id === id) pick = flows[i];
      if (!pick) pick = flows[flows.length - 1];
      var g = await api('/api/flows/' + encodeURIComponent(pick.id));
      if (g.ok && g.flow) {
        renderFlow(g.flow);
        toast('已加载流程：' + (g.flow.name || pick.id), 'info');
      }
    } catch (e) { /* 后端不可达时静默（file:// 打开也能用） */ }
  }

  /* ── 运行（默认简易实现，edges.js 可覆盖 window.__wfRun 增强） ── */
  function setRunState(active) {
    state.runState = !!active;
    el.edgeSvg.classList.toggle('run-active', state.runState);
    emit('run-state', state.runState);
  }
  function setRunResults(results) {
    results = results || {};
    state.nodes.forEach(function (n) { n.run = results[n.id] || null; });
    renderNodes();
    updateEdges();
  }
  function clearRunResults() {
    state.nodes.forEach(function (n) { n.run = null; });
    renderNodes();
    updateEdges();
  }
  async function defaultRun() {
    if (!state.nodes.length) { toast('画布为空，先拖入模块', 'warn'); return; }
    var payload = {
      nodes: state.nodes.map(function (n) {
        return { id: n.id, kind: n.kind, title: n.title, prompt: n.prompt };
      }),
      edges: state.edges.map(function (e) {
        return { id: e.id, source: e.source, target: e.target, data: e.data || {} };
      })
    };
    setRunState(true);
    var pending = {};
    state.nodes.forEach(function (n) { pending[n.id] = { status: 'running' }; });
    setRunResults(pending);
    toast('流程运行中…', 'info');
    try {
      var d = await api('/api/flows/run', { method: 'POST', body: payload });
      if (d.ok) {
        setRunResults(d.results || {});
        var done = 0, total = state.nodes.length;
        Object.keys(d.results || {}).forEach(function (k) {
          if (d.results[k].status === 'done') done++;
        });
        toast('运行完成：' + done + ' / ' + total + ' 个模块成功', done === total ? 'success' : 'warn');
      } else {
        clearRunResults();
        toast('运行失败：' + (d.error || '未知错误'), 'error');
      }
    } catch (e) {
      clearRunResults();
      toast('运行失败：' + e.message, 'error');
    }
    setTimeout(function () { setRunState(false); }, 1400);
  }
  function clickRun() {
    emit('run-requested');
    if (typeof window.__wfRun === 'function') {
      try { window.__wfRun(); } catch (e) { toast('运行出错：' + e.message, 'error'); }
      return;
    }
    defaultRun();
  }

  /* ── 事件接线 ─────────────────────────────────────────── */
  function wireToolbar() {
    el.btnSettings.addEventListener('click', openSettings);
    el.btnSave.addEventListener('click', function () {
      saveCanvas().catch(function (e) { toast('保存失败：' + e.message, 'error'); });
    });
    el.btnRun.addEventListener('click', clickRun);
  }

  function wireRail() {
    var btns = document.querySelectorAll('.rail-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () {
        toggleDrawer(this.getAttribute('data-kind'));
      });
    }
    el.drawerClose.addEventListener('click', closeDrawer);
  }

  function wireCanvas() {
    // 节点层：按下处理拖拽 / 连接 / 选中
    el.nodesLayer.addEventListener('pointerdown', function (e) {
      var nodeEl = e.target.closest('.wf-node');
      if (!nodeEl) return;
      var id = nodeEl.getAttribute('data-id');
      if (e.target.closest('.port-out')) {
        var n = getNode(id);
        if (n) startConnect(n, e);
        return;
      }
      if (e.target.closest('.node-action')) return; // 交给 click
      if (e.target.closest('.port-in')) { selectNode(id); return; }
      startDragNode(id, e);
    });
    // 起点目标（goal）输入：事件委托（renderNodes 会重建 DOM，故绑定在容器上）
    el.nodesLayer.addEventListener('input', function (e) {
      var inp = e.target.closest('.wf-goal-input');
      if (!inp) return;
      var id = inp.getAttribute('data-goal');
      var n = getNode(id);
      if (!n) return;
      n.goal = inp.value;
      emit('node-updated', n);
    });
    // 起点目标（goal）失去焦点：更新画布上的提示态（无需重渲染）
    el.nodesLayer.addEventListener('blur', function (e) {
      var inp = e.target.closest('.wf-goal-input');
      if (!inp) return;
      var id = inp.getAttribute('data-goal');
      var n = getNode(id);
      if (!n) return;
      if (hasGoal()) toast('目标已设置，可以拖入其它模块了', 'success');
      else toast('请填写全局目标后再拖入其它模块', 'info');
    }, true);
    // 节点操作按钮
    el.nodesLayer.addEventListener('click', function (e) {
      var act = e.target.closest('.node-action');
      if (!act) return;
      var nodeEl = act.closest('.wf-node');      if (!nodeEl) return;
      var id = nodeEl.getAttribute('data-id');
      var n = getNode(id);
      if (!n) return;
      if (act.getAttribute('data-act') === 'regen') {
        if (n.status === 'generating') return;
        generateForNode(n);
      } else if (act.getAttribute('data-act') === 'del') {
        removeNode(id);
      }
    });
    // 点击空白取消选中
    el.canvasWrap.addEventListener('pointerdown', function (e) {
      if (e.target === el.canvas || e.target === el.nodesLayer) deselectAll();
    });
    // 点击连线 / 标签选中
    el.edgeSvg.addEventListener('click', function (e) {
      var hit = e.target.closest('.wf-edge-hit');
      if (hit) selectEdge(hit.getAttribute('data-edge'));
    });
    el.edgeLabels.addEventListener('click', function (e) {
      var lab = e.target.closest('.wf-edge-label');
      if (lab) selectEdge(lab.getAttribute('data-edge'));
    });
  }

  function wirePicker() {
    el.pickerCancel.addEventListener('click', function () { closePicker(false); });
    el.pickerClose.addEventListener('click', function () { closePicker(false); });
    el.pickerOverlay.addEventListener('click', function (e) {
      if (e.target === el.pickerOverlay) closePicker(false);
    });
  }

  function wireSettings() {
    el.settingsClose.addEventListener('click', closeSettings);
    el.setCancel.addEventListener('click', closeSettings);
    el.settingsOverlay.addEventListener('click', function (e) {
      if (e.target === el.settingsOverlay) closeSettings();
    });
    el.setProvider.addEventListener('change', onProviderChange);
    el.keyToggle.addEventListener('click', function () {
      var inp = el.setApiKey;
      inp.type = (inp.type === 'password') ? 'text' : 'password';
      el.keyToggle.textContent = (inp.type === 'password') ? '👁' : '🙈';
    });
    el.setSave.addEventListener('click', function () {
      saveSettings().then(function () {
        toast('设置已保存', 'success');
        closeSettings();
      }).catch(function (e) { toast('保存失败：' + e.message, 'error'); });
    });
    el.setTest.addEventListener('click', testSettings);
  }

  function wirePanel() {
    el.infoPanel.addEventListener('click', function (e) {
      var b = e.target.closest('[data-pact]');
      if (!b) return;
      var act = b.getAttribute('data-pact');
      if (act === 'regen') {
        var n = getNode(state.selectedNodeId);
        if (n && n.status !== 'generating') generateForNode(n);
      } else if (act === 'del') {
        removeNode(state.selectedNodeId);
      } else if (act === 'del-edge') {
        removeEdge(state.selectedEdgeId);
      }
    });
  }

  function wireKeyboard() {
    document.addEventListener('keydown', function (e) {
      var tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
      if (e.key === 'Escape') {
        if (!el.pickerOverlay.classList.contains('hidden')) { closePicker(false); return; }
        if (!el.settingsOverlay.classList.contains('hidden')) { closeSettings(); return; }
        if (state.drawerOpen) { closeDrawer(); return; }
        deselectAll();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (state.selectedNodeId) { e.preventDefault(); removeNode(state.selectedNodeId); }
        else if (state.selectedEdgeId) { e.preventDefault(); removeEdge(state.selectedEdgeId); }
      }
    });
  }

  /* ── 初始化 ───────────────────────────────────────────── */
  function cacheEls() {
    el.toasts = document.getElementById('toasts');
    el.flowName = document.getElementById('flow-name');
    el.configBadge = document.getElementById('config-badge');
    el.configBadgeText = el.configBadge.querySelector('.badge-text');
    el.btnSave = document.getElementById('btn-save');
    el.btnRun = document.getElementById('btn-run');
    el.btnSettings = document.getElementById('btn-settings');
    el.drawer = document.getElementById('drawer');
    el.drawerTitle = document.getElementById('drawer-title');
    el.drawerClose = document.getElementById('drawer-close');
    el.drawerBody = document.getElementById('drawer-body');
    el.canvasWrap = document.getElementById('canvas-wrap');
    el.canvas = document.getElementById('canvas');
    el.edgeSvg = document.getElementById('edge-svg');
    el.edgeLabels = document.getElementById('edge-labels');
    el.nodesLayer = document.getElementById('nodes-layer');
    el.canvasHint = document.getElementById('canvas-hint');
    el.dropHint = document.getElementById('drop-hint');
    el.infoPanel = document.getElementById('info-panel');
    el.panelEmpty = document.getElementById('panel-empty');
    el.panelNode = document.getElementById('panel-node');
    el.panelEdge = document.getElementById('panel-edge');
    el.pickerOverlay = document.getElementById('picker-overlay');
    el.pickerTitle = document.getElementById('picker-title');
    el.pickerNote = document.getElementById('picker-note');
    el.pickerList = document.getElementById('picker-list');
    el.pickerCancel = document.getElementById('picker-cancel');
    el.pickerClose = document.getElementById('picker-close');
    el.settingsOverlay = document.getElementById('settings-overlay');
    el.setProvider = document.getElementById('set-provider');
    el.setBaseUrl = document.getElementById('set-base-url');
    el.setModel = document.getElementById('set-model');
    el.setApiKey = document.getElementById('set-api-key');
    el.keyToggle = document.getElementById('key-toggle');
    el.setTest = document.getElementById('set-test');
    el.setSave = document.getElementById('set-save');
    el.setCancel = document.getElementById('set-cancel');
    el.settingsClose = document.getElementById('settings-close');
    el.settingsForm = document.getElementById('settings-form');
  }

  function init() {
    cacheEls();
    buildDefs();
    wireToolbar();
    wireRail();
    wireCanvas();
    wirePicker();
    wireSettings();
    wirePanel();
    wireKeyboard();
    renderNodes();
    updateEdges();
    refreshConfigBadge();
    loadLastFlow();
    // 首次进入（无任何节点）自动放置唯一起点，并提醒填写目标
    if (state.nodes.length === 0) ensureRootIfEmpty();
    // 若加载了已有流程但没有起点，也自动补一个（保证画布始终有唯一起点）
    if (!rootNode()) ensureRootIfEmpty();
    // 健康检查（静默，后端不可达不影响画布）
    fetch('/api/health').catch(function () { /* 忽略 */ });
    emit('ready');
  }

  /* ── 公共接口（供 js/edges.js 扩展） ──────────────────── */
  window.__wf = {
    // 数据（只读快照）
    getNodes: function () { return state.nodes.slice(); },
    getEdges: function () { return state.edges.slice(); },
    getNode: getNode,
    getEdge: getEdge,
    getSelectedNode: function () { return state.selectedNodeId ? getNode(state.selectedNodeId) : null; },
    getSelectedEdge: function () { return state.selectedEdgeId ? getEdge(state.selectedEdgeId) : null; },
    getFlowData: serialize,
    getPlanContext: buildGenCtx,
    getCanvasRect: function () { return el.canvas.getBoundingClientRect(); },
    clientToCanvas: clientToCanvas,

    // 节点
    addNode: addNode,
    removeNode: removeNode,
    selectNode: selectNode,
    deselectAll: deselectAll,
    renderNodes: renderNodes,

    // 连线
    addEdge: addEdge,
    removeEdge: removeEdge,
    selectEdge: selectEdge,
    updateEdges: updateEdges,
    refreshEdgeSemantics: updateEdgeSemantics,

    // 候选生成
    generateCandidates: function (kind, ctx) {
      return api('/api/module/generate', { method: 'POST', body: { kind: kind, ctx: ctx } })
        .then(function (d) { return d.candidates || []; });
    },
    applyCandidate: applyCandidate,

    // 运行状态（edges.js 用）
    setRunState: setRunState,
    setRunResults: setRunResults,
    clearRunResults: clearRunResults,
    run: clickRun,

    // 设置
    openSettings: openSettings,
    closeSettings: closeSettings,
    refreshConfigBadge: refreshConfigBadge,

    // 保存 / 加载
    saveCanvas: saveCanvas,
    loadFlow: renderFlow,

    // 事件总线
    on: on,
    emit: emit,

    // 工具
    api: api,
    toast: toast,

    // DOM 引用（初始化完成后可用）
    el: el,
    KINDS: KINDS,
    constants: { NODE_W: NODE_W, NODE_H: NODE_H }
  };

  // 运行钩子：edges.js 可整体覆盖（含动画、逐节点状态、结果面板等）
  window.__wfRun = null;
  // 连线语义钩子：edges.js 可覆盖（如加入上下文与 plan 信息）
  window.__wfEdgeSemantic = null;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
