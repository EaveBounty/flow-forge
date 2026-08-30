/**
 * edges.js — 「连线语义 + 运行可视化」模块
 *
 * 与 app.js（画布核心）协作。app.js 已实现：节点/连线存储、连线渲染
 * （#edge-svg / #edge-labels）、端口拖拽建线、连线语义自动生成
 * （POST /api/edge/semantic + 离线兜底）、#info-panel 连线面板、事件总线。
 *
 * 本模块的职责与增强（index.html 中 #btn-run 已注明「由 js/edges.js 接管
 * window.__wfRun」，app.js 顶部注释亦声明 edges.js 可覆盖 __wfRun 增强）：
 *   1. window.__wfRun = runFlow —— 接管「运行」：读画布 → POST /api/flows/run →
 *      按拓扑顺序逐节点播放：呼吸灯 → 结果气泡 → 出边「流动中(虚线动画)→已流动(渐变实线)」。
 *   2. window.__wf 契约补充（app.js 已有同名能力的则委托，缺失才本地兜底）：
 *        __wf.onNodeFromPort(sourceId, targetId) → 委托 app.js addEdge（内部已自动生成语义）
 *        __wf.renderEdgeLabels()                 → 委托 app.js updateEdges()
 *        __wf.showEdgePanel(edgeInfo)            → 委托 app.js selectEdge()（右侧面板显示 label/description/injection）
 *        __wf.hideEdgePanel()                    → 委托 app.js deselectAll()
 *        __wf.redrawEdges()                      → 委托 app.js updateEdges()
 *        __wf.importEdges(edges)                 → 补入缺失连线（触发语义）
 *        __wf.getNodes() / __wf.getEdges()       → 直接用 app.js 的实现（仅缺失时 DOM 兜底）
 *        __wf.visualizeRun(results, outputs)     → 本模块运行回填（虚线流动 + 结果气泡）
 *        __wf.clearRunState()                    → 清空运行痕迹
 *   3. 运行可视化：节点呼吸灯（.wf-run-ring）、结果气泡（.wf-node-bubble，
 *      summary/detail/score）、连线「流动中→已流动」状态（.is-flowing/.is-flowed）。
 *
 * 硬性规则（用户反复强调）：
 *   1. 平时（未运行）连线一律实线（app.js 渲染的 .wf-edge 默认 solid）。
 *   2. 虚线 + 流动动画（stroke-dasharray + @keyframes wf-edge-flow）只在本模块
 *      运行可视化的「流动中」状态出现；运行结束恢复实线，用 .is-flowed
 *      （渐变描边 + 柔光）区分「已流动」，不使用虚线。
 *   3. 用户绝不打字：连线语义由后端 LLM 自动生成（app.js 已实现离线兜底）。
 */
(function () {
  'use strict';

  /* ═══════════════════════ 契约对象 ═══════════════════════ */
  window.__wf = window.__wf || {};
  var wf = window.__wf;

  /* ═══════════════════════ 内部状态 ═══════════════════════ */
  var state = { running: false, busyTimer: null };

  /* ═══════════════════════ 工具 ═══════════════════════ */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }
  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }
  function cssEscape(s) {
    if (window.CSS && CSS.escape) return CSS.escape(String(s));
    return String(s).replace(/["\\]/g, '\\$&');
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function toast(msg, type) {
    if (typeof wf.toast === 'function') { wf.toast(msg, type); return; }
    var mount = document.getElementById('toasts');
    if (!mount) return;
    var t = el('div', 'toast toast-' + (type || 'info'));
    t.appendChild(el('span', 'toast-dot'));
    t.appendChild(el('span', null, msg));
    mount.appendChild(t);
    setTimeout(function () {
      t.classList.add('leaving');
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 280);
    }, 3400);
  }

  /* ═══════════════════════ 契约包装（委托 app.js 的实现） ═══════════════════════ */
  function onNodeFromPort(sourceId, targetId) {
    // app.js 的 addEdge 会去重、渲染并自动调 /api/edge/semantic 生成语义
    if (typeof wf.addEdge === 'function') {
      var edge = wf.addEdge(sourceId, targetId);
      return Promise.resolve(edge || null);
    }
    return Promise.resolve(null);
  }

  function renderEdgeLabels() {
    if (typeof wf.updateEdges === 'function') wf.updateEdges();
  }

  function showEdgePanel(edgeInfo) {
    if (!edgeInfo) return;
    if (typeof wf.selectEdge === 'function') {
      var id = edgeInfo.id || (edgeInfo.source && edgeInfo.target && findEdgeIdByPair(edgeInfo.source, edgeInfo.target));
      if (id) wf.selectEdge(id);
    }
  }

  function hideEdgePanel() {
    if (typeof wf.deselectAll === 'function') wf.deselectAll();
  }

  function redrawEdges() {
    if (typeof wf.updateEdges === 'function') wf.updateEdges();
  }

  function findEdgeIdByPair(source, target) {
    var edges = wf.getEdges ? wf.getEdges() : [];
    for (var i = 0; i < edges.length; i++) {
      if (edges[i].source === source && edges[i].target === target) return edges[i].id;
    }
    return null;
  }

  function importEdges(edges) {
    if (!Array.isArray(edges)) return;
    var existing = wf.getEdges ? wf.getEdges() : [];
    var pairSeen = {};
    existing.forEach(function (e) { pairSeen[e.source + '→' + e.target] = true; });
    edges.forEach(function (e) {
      if (!e || !e.source || !e.target) return;
      var key = e.source + '→' + e.target;
      if (pairSeen[key]) return;
      pairSeen[key] = true;
      if (typeof wf.addEdge === 'function') wf.addEdge(e.source, e.target);
    });
    redrawEdges();
  }

  function getNodesFallback() {
    // app.js 缺失时的 DOM 兜底（正常情况不会走到）
    var layer = document.getElementById('nodes-layer');
    var els = layer ? layer.querySelectorAll('.wf-node') : [];
    var out = [];
    for (var i = 0; i < els.length; i++) {
      var n = els[i];
      var titleEl = n.querySelector('.wf-node-title');
      out.push({
        id: n.getAttribute('data-id'),
        kind: (n.className.match(/\bkind-([a-z]+)\b/i) || [null, 'action'])[1].toLowerCase(),
        title: (titleEl && titleEl.textContent.trim()) || '模块',
        prompt: '',
        x: 0, y: 0
      });
    }
    return out.filter(function (n) { return !!n.id; });
  }

  /* ═══════════════════════ 运行可视化：DOM 助手 ═══════════════════════ */
  function nodeElById(id) {
    var layer = document.getElementById('nodes-layer');
    if (!layer) return null;
    return layer.querySelector('.wf-node[data-id="' + cssEscape(id) + '"]');
  }

  /* 找到某条边在 #edge-svg 里的可见路径（.wf-edge）：通过 .wf-edge-hit[data-edge] 定位 */
  function edgePathEl(edgeId) {
    var svg = document.getElementById('edge-svg');
    if (!svg) return null;
    var hit = svg.querySelector('.wf-edge-hit[data-edge="' + cssEscape(edgeId) + '"]');
    if (!hit) return null;
    var prev = hit.previousElementSibling;
    return (prev && prev.classList && prev.classList.contains('wf-edge')) ? prev : null;
  }

  function setEdgeFlowing(edgeId, on) {
    var p = edgePathEl(edgeId);
    if (p) p.classList.toggle('is-flowing', !!on);
  }

  function setEdgeFlowed(edgeId, on) {
    var p = edgePathEl(edgeId);
    if (p) {
      p.classList.toggle('is-flowed', !!on);
      if (on) p.classList.remove('is-flowing');
    }
  }

  function addRunRing(nodeEl, on) {
    if (!nodeEl) return;
    var ring = nodeEl.querySelector('.wf-run-ring');
    if (on) {
      if (!ring) {
        ring = el('div', 'wf-run-ring');
        nodeEl.appendChild(ring);
      }
      nodeEl.classList.add('is-running');
    } else {
      if (ring) ring.remove();
      nodeEl.classList.remove('is-running');
    }
  }

  /* 在节点本体区域显示运行状态（复用 app.js 的 .wf-node-run / .wf-node-spinner 样式） */
  function setNodeBodyRun(nodeEl, run) {
    if (!nodeEl) return;
    var body = nodeEl.querySelector('.wf-node-body');
    if (!body) return;
    if (!run) return;
    if (run.status === 'running') {
      body.innerHTML = '<span class="wf-node-spinner"></span><span class="wf-node-gen">运行中…</span>';
    } else if (run.status === 'error') {
      body.innerHTML = '<span class="wf-node-run run-error">✗ ' + esc(run.summary || '出错') + '</span>';
    } else {
      var score = (typeof run.score === 'number') ? (' · 评分 ' + run.score) : '';
      body.innerHTML = '<span class="wf-node-run run-done">✓ ' + esc(run.summary || '完成') + score + '</span>';
    }
  }

  function showBubble(nodeEl, result, output) {
    if (!nodeEl) return;
    var bubble = el('div', 'wf-node-bubble');
    var summary = result.summary || '完成';
    var score = typeof result.score === 'number' ? result.score : null;
    var detail = result.detail || output || '';
    var isErr = (result.status || 'done') === 'error';
    if (isErr) bubble.classList.add('is-error');

    var head = el('div', 'wf-bubble-head');
    head.appendChild(el('span', 'wf-bubble-status', isErr ? '✕' : '✓'));
    head.appendChild(el('span', 'wf-bubble-summary', summary));
    if (score !== null) {
      var scoreEl = el('span', 'wf-bubble-score', Math.round(score * 100) + '分');
      if (score >= 0.9) scoreEl.classList.add('is-good');
      else if (score >= 0.75) scoreEl.classList.add('is-mid');
      else scoreEl.classList.add('is-low');
      head.appendChild(scoreEl);
    }
    bubble.appendChild(head);

    if (detail) {
      bubble.appendChild(el('div', 'wf-bubble-detail', detail));
      bubble.setAttribute('title', '点击展开/收起详情');
      bubble.addEventListener('click', function () { bubble.classList.toggle('is-open'); });
      // 避免点击气泡触发 app.js 的节点拖拽
      bubble.addEventListener('pointerdown', function (ev) { ev.stopPropagation(); });
    }
    nodeEl.appendChild(bubble);
    requestAnimationFrame(function () { bubble.classList.add('is-in'); });
  }

  /* ═══════════════════════ 拓扑排序（与后端一致） ═══════════════════════ */
  function topoOrder(nodes, edges) {
    var ids = nodes.map(function (n) { return n.id; });
    var indeg = {};
    var adj = {};
    ids.forEach(function (i) { indeg[i] = 0; adj[i] = []; });
    edges.forEach(function (e) {
      if (indeg[e.source] === undefined || indeg[e.target] === undefined) return;
      adj[e.source].push(e.target);
      indeg[e.target] += 1;
    });
    var order = [];
    var q = ids.filter(function (i) { return indeg[i] === 0; });
    while (q.length) {
      var cur = q.shift();
      order.push(cur);
      adj[cur].forEach(function (nxt) {
        indeg[nxt] -= 1;
        if (indeg[nxt] === 0) q.push(nxt);
      });
    }
    ids.forEach(function (i) { if (order.indexOf(i) < 0) order.push(i); });
    return order;
  }

  /* ═══════════════════════ 清空运行痕迹 ═══════════════════════ */
  function clearRunState() {
    // 清掉所有边上的流动/已流动状态
    var svg = document.getElementById('edge-svg');
    if (svg) {
      var paths = svg.querySelectorAll('.wf-edge.is-flowing, .wf-edge.is-flowed');
      for (var i = 0; i < paths.length; i++) {
        paths[i].classList.remove('is-flowing', 'is-flowed');
      }
    }
    // 清掉节点上的呼吸灯 / 气泡 / 状态类
    var layer = document.getElementById('nodes-layer');
    if (layer) {
      var nodes = layer.querySelectorAll('.wf-node');
      for (var j = 0; j < nodes.length; j++) {
        nodes[j].classList.remove('is-running', 'wf-node--done');
        var ring = nodes[j].querySelector('.wf-run-ring');
        if (ring) ring.remove();
        var bubbles = nodes[j].querySelectorAll('.wf-node-bubble');
        for (var k = 0; k < bubbles.length; k++) bubbles[k].remove();
      }
    }
    // 重置 app.js 的节点 run 数据（其内部会重渲染节点）
    if (typeof wf.clearRunResults === 'function') wf.clearRunResults();
  }

  /* ═══════════════════════ 运行可视化核心 ═══════════════════════ */
  async function runVisualization(results, outputs) {
    results = results || {};
    outputs = outputs || {};
    var nodes = wf.getNodes ? wf.getNodes() : getNodesFallback();
    var edges = wf.getEdges ? wf.getEdges() : [];
    var order = topoOrder(nodes, edges);

    // 把结果写入 app.js 的 store（节点被重渲染时显示 run chip）
    if (typeof wf.getNode === 'function') {
      nodes.forEach(function (n) {
        if (results[n.id]) {
          var storeNode = wf.getNode(n.id);
          if (storeNode) storeNode.run = results[n.id];
        }
      });
    }

    emit('run-start');
    for (var i = 0; i < order.length; i++) {
      var nid = order[i];
      var nodeEl = nodeElById(nid);
      var res = results[nid];

      // 节点：呼吸灯 + 运行中
      if (nodeEl) {
        addRunRing(nodeEl, true);
        setNodeBodyRun(nodeEl, { status: 'running' });
      }
      emit('node-progress', { id: nid, status: 'running' });
      await sleep(650);

      // 节点：完成 → 结果气泡 + 已流动标记
      if (nodeEl) {
        addRunRing(nodeEl, false);
        nodeEl.classList.add('wf-node--done');
        if (res) {
          setNodeBodyRun(nodeEl, res);
          showBubble(nodeEl, res, outputs[nid]);
        }
      }

      // 该节点的出边：流动中（虚线 + 动画）→ 已流动（渐变实线）
      var outs = edges.filter(function (e) { return e.source === nid; });
      outs.forEach(function (e) { setEdgeFlowing(e.id, true); });
      if (outs.length) await sleep(750);
      outs.forEach(function (e) {
        setEdgeFlowing(e.id, false);
        setEdgeFlowed(e.id, true);
      });

      emit('node-progress', { id: nid, status: 'done', result: res });
    }
    toast('运行完成 ✓', 'success');
    emit('run-end', { results: results, outputs: outputs });
  }

  /* ── 契约接口：运行回填（外部拿到 results/outputs 后可直接调用） ── */
  async function visualizeRun(results, outputs) {
    if (state.running) return;
    state.running = true;
    setRunButtonBusy(true);
    try {
      clearRunState();
      await runVisualization(results, outputs);
    } finally {
      state.running = false;
      setRunButtonBusy(false);
    }
  }

  /* ── 一键运行：读画布 → /api/flows/run → 运行可视化 ── */
  async function runFlow() {
    if (state.running) return;
    var nodes = wf.getNodes ? wf.getNodes() : getNodesFallback();
    var edges = wf.getEdges ? wf.getEdges() : [];
    if (!nodes.length) {
      toast('画布为空，先拖入模块', 'warn');
      return;
    }
    var payload = {
      nodes: nodes.map(function (n) {
        return { id: n.id, kind: n.kind || 'action', title: n.title || '模块', prompt: n.prompt || '' };
      }),
      edges: edges.map(function (e) {
        return { source: e.source, target: e.target, data: e.data || {} };
      }),
    };
    state.running = true;
    setRunButtonBusy(true);
    clearRunState();
    try {
      var resp = await fetch('/api/flows/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      var data = await resp.json();
      if (!data || !data.ok) throw new Error((data && data.error) || '运行失败');
      await runVisualization(data.results || {}, data.outputs || {});
    } catch (err) {
      toast('运行失败：' + (err && err.message ? err.message : String(err)), 'error');
      emit('run-end', { error: err && err.message ? err.message : String(err) });
    } finally {
      state.running = false;
      setRunButtonBusy(false);
    }
  }

  /* ═══════════════════════ 运行按钮状态 ═══════════════════════ */
  function setRunButtonBusy(busy) {
    var btn = document.getElementById('btn-run');
    if (!btn) return;
    btn.classList.toggle('is-running', busy);
    btn.disabled = busy;
    btn.setAttribute('aria-busy', busy ? 'true' : 'false');
  }

  /* ═══════════════════════ 事件转发（wf.emit 缺失时兜底） ═══════════════════════ */
  function emit(ev, payload) {
    if (typeof wf.emit === 'function') {
      try { wf.emit(ev, payload); } catch (e) { /* noop */ }
    }
  }

  /* ═══════════════════════ 契约装配 ═══════════════════════ */
  function ensureGradDef() {
    // .is-flowed 的渐变描边依赖 #wf-edge-grad；app.js 的 buildDefs 不包含它，由本模块补上
    var svg = document.getElementById('edge-svg');
    if (!svg) return;
    var defs = svg.querySelector('defs');
    if (!defs) {
      defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      svg.appendChild(defs);
    }
    if (defs.querySelector('#wf-edge-grad')) return;
    var lg = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
    lg.id = 'wf-edge-grad';
    lg.setAttribute('x1', '0%'); lg.setAttribute('y1', '0%');
    lg.setAttribute('x2', '100%'); lg.setAttribute('y2', '0%');
    var s1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    s1.setAttribute('offset', '0%'); s1.setAttribute('stop-color', '#00A6FF');
    var s2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    s2.setAttribute('offset', '100%'); s2.setAttribute('stop-color', '#00E0C6');
    lg.appendChild(s1); lg.appendChild(s2);
    defs.appendChild(lg);
  }

  function assembleContract() {
    // app.js 已有的核心能力（getNodes/getEdges/getNode/addEdge/selectEdge…）不动，
    // 只补充本模块的接口（缺失才用兜底实现）。
    if (typeof wf.onNodeFromPort !== 'function') wf.onNodeFromPort = onNodeFromPort;
    if (typeof wf.renderEdgeLabels !== 'function') wf.renderEdgeLabels = renderEdgeLabels;
    if (typeof wf.showEdgePanel !== 'function') wf.showEdgePanel = showEdgePanel;
    if (typeof wf.hideEdgePanel !== 'function') wf.hideEdgePanel = hideEdgePanel;
    if (typeof wf.redrawEdges !== 'function') wf.redrawEdges = redrawEdges;
    if (typeof wf.importEdges !== 'function') wf.importEdges = importEdges;
    if (typeof wf.visualizeRun !== 'function') wf.visualizeRun = visualizeRun;
    if (typeof wf.clearRunState !== 'function') wf.clearRunState = clearRunState;
    if (typeof wf.runFlow !== 'function') wf.runFlow = runFlow;
    if (typeof wf.getNodes !== 'function') wf.getNodes = getNodesFallback;

    // 运行入口：app.js 的 #btn-run → clickRun → window.__wfRun()
    window.__wfRun = runFlow;

    wf.__edgesReady = true;
  }

  /* ═══════════════════════ 初始化 ═══════════════════════ */
  function init() {
    ensureGradDef();
    assembleContract();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
