/* 冒烟测试：用最小 DOM stub 在 Node 中加载 web/js/app.js，验证初始化与核心流程无运行时错误 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeEl(id) {
  const children = [];
  const el = {
    id: id || '',
    children,
    style: { setProperty() {}, },
    dataset: {},
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      toggle(c, force) {
        const on = force === undefined ? !this._s.has(c) : !!force;
        if (on) this._s.add(c); else this._s.delete(c);
        return on;
      },
      contains(c) { return this._s.has(c); },
    },
    _innerHTML: '',
    textContent: '',
    title: '',
    addEventListener() {},
    removeEventListener() {},
    appendChild(child) { children.push(child); return child; },
    removeChild(child) {
      const i = children.indexOf(child);
      if (i >= 0) children.splice(i, 1);
      return child;
    },
    setAttribute(k, v) { this[k] = v; },
    getAttribute(k) { return this[k] || null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800 }; },
    parentNode: null,
    closest() { return null; },
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return this._innerHTML; },
    set(v) { this._innerHTML = v; },
  });
  return el;
}

const els = {};
const ids = [
  'toasts', 'flow-name', 'config-badge', 'btn-save', 'btn-run', 'btn-settings',
  'drawer', 'drawer-title', 'drawer-close', 'drawer-body',
  'canvas-wrap', 'canvas', 'edge-svg', 'edge-labels', 'nodes-layer',
  'canvas-hint', 'drop-hint', 'info-panel', 'panel-empty', 'panel-node', 'panel-edge',
  'picker-overlay', 'picker-title', 'picker-note', 'picker-list', 'picker-cancel', 'picker-close',
  'settings-overlay', 'set-provider', 'set-base-url', 'set-model', 'set-api-key',
  'key-toggle', 'set-test', 'set-save', 'set-cancel', 'settings-close', 'settings-form',
];
ids.forEach((id) => { els[id] = makeEl(id); });
els['config-badge'].querySelector = () => els['badge-text'];
els['badge-text'] = makeEl('badge-text');

const documentStub = {
  readyState: 'complete',
  createElement(tag) {
    const e = makeEl('created-' + tag);
    e.tagName = tag.toUpperCase();
    return e;
  },
  createElementNS(ns, tag) {
    const e = makeEl('ns-' + tag);
    e.tagName = tag.toUpperCase();
    e.namespaceURI = ns;
    return e;
  },
  getElementById(id) { return els[id] || null; },
  addEventListener() {},
  body: makeEl('body'),
  querySelectorAll() { return []; },
};

function boot(fetchImpl) {
  const calls = [];
  const sandbox = {
    console,
    document: documentStub,
    window: { addEventListener() {}, },
    fetch: (url, opts) => { calls.push(url + ' ' + (opts && opts.method || 'GET')); return fetchImpl(url, opts); },
    setTimeout,
    clearTimeout,
    requestAnimationFrame: (fn) => { fn(); return 1; },
    cancelAnimationFrame() {},
    Promise, Math, Date, JSON, String, Array, Object, parseInt, encodeURIComponent,
    localStorage: { getItem: () => null, setItem() {} },
  };
  sandbox.window.__wf = undefined;
  sandbox.window.__wfRun = null;
  sandbox.window.__wfEdgeSemantic = null;
  const code = fs.readFileSync(path.join(__dirname, '..', 'web', 'js', 'app.js'), 'utf-8');
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'app.js' });
  return { wf: sandbox.window.__wf, calls, sandbox };
}

const ok = (data) => ({ ok: true, status: 200, json: () => Promise.resolve(data) });
const fail = (data) => ({ ok: false, status: 500, json: () => Promise.resolve(data) });

// ── 场景 A：正常配置 + 候选生成 + 连线语义 + 运行 + 保存/加载 ──
(async () => {
  const { wf, calls, sandbox } = boot((url) => {
    if (url === '/api/settings') return Promise.resolve(ok({ ok: true, settings: { provider: 'deepseek', base_url: '', model: 'deepseek-chat', has_key: true } }));
    if (url === '/api/flows') return Promise.resolve(ok({ ok: true, flows: [] }));
    if (url === '/api/health') return Promise.resolve(ok({ ok: true }));
    if (url === '/api/module/generate') return Promise.resolve(ok({ ok: true, candidates: [
      { id: 'c1', title: '候选A', description: '描述A', prompt: '提示A', recommended: true },
      { id: 'c2', title: '候选B', description: '描述B', prompt: '提示B', recommended: false },
    ] }));
    if (url === '/api/edge/semantic') return Promise.resolve(ok({ ok: true, intent: 'context', label: '结合语义', description: '说明', injection: '注入' }));
    if (url === '/api/flows/run') return Promise.resolve(ok({ ok: true, run_id: 'r1', results: {}, outputs: {} }));
    return Promise.resolve(fail({ ok: false, error: 'no stub' }));
  });

  const n1 = wf.addNode('root', { title: '流程起点', description: 'd', prompt: 'p' }, 100, 100);
  if (n1.status !== 'generating') throw new Error('addNode 后应为 generating');
  await new Promise((r) => setTimeout(r, 20));
  if (calls.filter((c) => c.startsWith('/api/module/generate')).length !== 1) throw new Error('未调用 module/generate');
  if (els['picker-overlay'].classList.contains('hidden')) throw new Error('候选弹层未显示');

  const node = wf.getNode(n1.id);
  wf.applyCandidate(node, { title: '候选A', description: '描述A', prompt: '提示A', recommended: true });
  if (node.title !== '候选A' || node.status !== 'ready') throw new Error('applyCandidate 失败');

  const n2 = wf.addNode('action', { title: '执行任务', description: 'd', prompt: 'p' }, 400, 100);
  await new Promise((r) => setTimeout(r, 20));
  const edge = wf.addEdge(n1.id, n2.id);
  await new Promise((r) => setTimeout(r, 20));
  if (!wf.getEdge(edge.id).data || !wf.getEdge(edge.id).data.label) throw new Error('连线语义未生成');

  // 生成上下文应能找到上游
  const ctx = wf.getPlanContext(wf.getNode(n2.id));
  if (!ctx.upstream.includes('候选A')) throw new Error('上游标题缺失: ' + JSON.stringify(ctx));

  // 运行钩子：默认实现
  wf.run();
  await new Promise((r) => setTimeout(r, 20));
  if (!calls.includes('/api/flows/run POST')) throw new Error('默认运行未调 /api/flows/run');

  // 保存/加载
  const data = wf.getFlowData();
  if (!data.nodes.length || !data.edges.length) throw new Error('getFlowData 为空');
  wf.loadFlow({ id: 'flow-x', name: '测试', nodes: data.nodes, edges: data.edges });
  if (wf.getNodes().length !== 2) throw new Error('loadFlow 失败');

  wf.removeNode(n1.id);
  wf.removeEdge(edge.id);
  if (wf.getNodes().length !== 1 || wf.getEdges().length !== 0) throw new Error('删除失败');

  // 设置保存（api_key 留空但有 has_key → 不应清空）
  documentStub.getElementById('set-provider').value = 'deepseek';
  documentStub.getElementById('set-base-url').value = 'https://api.deepseek.com/v1';
  documentStub.getElementById('set-model').value = 'deepseek-chat';
  documentStub.getElementById('set-api-key').value = '';
  await wf.refreshConfigBadge();

  console.log('A: 正常流程 OK');

  // ── 场景 B：离线回退（module/generate 失败） ──
  const B = boot((url) => {
    if (url === '/api/settings') return Promise.resolve(ok({ ok: true, settings: { provider: '', base_url: '', model: '', has_key: false } }));
    if (url === '/api/flows') return Promise.resolve(ok({ ok: true, flows: [] }));
    if (url === '/api/health') return Promise.resolve(ok({ ok: true }));
    if (url === '/api/module/generate') return Promise.reject(new Error('network down'));
    return Promise.resolve(fail({ ok: false, error: 'no stub' }));
  });
  const nb = B.wf.addNode('plan', { title: '拆解计划', description: 'd', prompt: 'p' }, 200, 200);
  await new Promise((r) => setTimeout(r, 20));
  if (els['picker-overlay'].classList.contains('hidden')) throw new Error('离线回退后弹层未显示');
  if (els['picker-note'].classList.contains('hidden')) throw new Error('回退提示未显示');
  console.log('B: 离线回退 OK');

  // ── 场景 C：edges.js 覆盖 window.__wfRun / __wfEdgeSemantic ──
  const C = boot((url) => {
    if (url === '/api/settings') return Promise.resolve(ok({ ok: true, settings: { provider: '', base_url: '', model: '', has_key: false } }));
    if (url === '/api/flows') return Promise.resolve(ok({ ok: true, flows: [] }));
    if (url === '/api/health') return Promise.resolve(ok({ ok: true }));
    if (url === '/api/module/generate') return Promise.resolve(ok({ ok: true, candidates: [{ id: 'c', title: 'T', description: 'D', prompt: 'P', recommended: true }] }));
    if (url === '/api/flows/run') return Promise.resolve(ok({ ok: true, results: {}, outputs: {} }));
    return Promise.resolve(fail({ ok: false, error: 'no stub' }));
  });
  let runCalled = false, semCalled = false;
  C.sandbox.window.__wfRun = function () { runCalled = true; };
  C.sandbox.window.__wfEdgeSemantic = function () { semCalled = true; return Promise.resolve({ intent: 'x', label: '自定义标签', description: 'd', injection: 'i' }); };
  const c1 = C.wf.addNode('action', { title: '执行', description: 'd', prompt: 'p' }, 100, 100);
  const c2 = C.wf.addNode('action', { title: '执行2', description: 'd', prompt: 'p' }, 400, 100);
  await new Promise((r) => setTimeout(r, 20));
  C.wf.addEdge(c1.id, c2.id);
  C.wf.run();
  await new Promise((r) => setTimeout(r, 20));
  if (!runCalled) throw new Error('window.__wfRun 覆盖未生效');
  if (!semCalled) throw new Error('window.__wfEdgeSemantic 覆盖未生效');
  const ce = C.wf.getEdges()[0];
  if (!ce.data || ce.data.label !== '自定义标签') throw new Error('自定义连线语义未生效');
  console.log('C: 覆盖钩子 OK');

  console.log('SMOKE ALL OK');
  process.exit(0);
})().catch((e) => { console.error('SMOKE FAIL:', e.message); process.exit(1); });
