# 前端核心实现报告 — `web/js/app.js`（画布核心）

> 撰写：前端核心构建子代理 · 状态：已交付并通过验证（2026-08-31）
> 配套文件：`web/index.html`、`web/css/style.css`、`web/js/app.js`、`scripts/smoke-app.cjs`
> 后端：FastAPI（`backend/main.py`，静态资源仅挂载在 `/static`）

---

## 1. 实现了什么

一个**零依赖**（不引入 React Flow / 任何框架）的原生 JS + SVG 单页画布前端，严格遵循项目核心理念：

1. **用户绝不打字**：画布上拖入的每个模块、连上的每条线，都由大模型自动生成候选描述，用户只从候选中**点选**一个（推荐项标「推荐」徽标）。
2. **四种菜单按钮视觉完全不同**：Plan / Action / Review / Loop 分别是 橙色圆角方块 / 绿色圆形 / 紫色旋转菱形 / 粉色六边形（Scratch 式色块），点击展开对应类型的模块抽屉，模板可拖拽到画布。
3. **虚线只在运行后才出现**：平时连线是实线（结构关系）；运行中 SVG 加 `run-active` 类 → CSS 变为虚线 + 流动动画（数据流动）。

### 功能清单

| 模块 | 说明 |
|---|---|
| 顶部工具栏 | 毛玻璃条：标题 + 流程名、模型状态徽标（已配置/未配置）、保存画布、运行、设置 |
| 左侧菜单栏 | 4 个形状迥异的按钮，点击展开/收起抽屉；抽屉分节展示 root/plan/action/review/loop/summary 六类初始模板 |
| 画布 | 绝对定位 div 节点 + SVG 连线（三次贝塞尔 + 箭头 marker + 连线中点标签）；点阵背景；空画布提示 |
| 节点 | 拖拽移动、选中态（类型色描边 + 悬浮操作钮：↻ 重新生成 / ✕ 删除）、Delete/Backspace 删除 |
| 候选生成 | 拖入即显示「生成中…」→ `POST /api/module/generate`（kind + ctx{plan, upstream}）→ 弹候选选择层；离线/未配置自动回退前端内置模板并提示 |
| 连线 | 从节点右侧出点拖到目标左侧入点（26px 吸附阈值）建线；`POST /api/edge/semantic` 自动生成 标签/意图/说明/注入；点击连线在右侧面板展示；节点标题变更后自动刷新相连连线语义 |
| 信息面板 | 右侧：选中节点显示 类型/标题/描述/Agent 提示词/推荐/重新生成/删除；选中连线显示 连接/标签/意图/说明/注入方式/删除 |
| 设置弹层 | 模型厂商（OpenAI/DeepSeek/OpenAI 兼容）/ Base URL（可选，按厂商给默认与占位）/ 模型 / API Key（type=password + 显隐按钮）；保存 `PUT /api/settings`、测试 `POST /api/settings/test`；保存后刷新徽标；API Key 留空且已有 key 时不清空 |
| 保存/加载 | 保存 `POST /api/flows`（flow id 记入 localStorage `wf:lastFlowId`）；启动时 `GET /api/flows` + `GET /api/flows/{id}` 自动加载最近流程 |
| 运行 | 内置简易实现（`POST /api/flows/run`，运行中虚线 + 节点运行态，完成显示 ✓/评分），**可被 edges.js 覆盖** |

### 部署兼容

- **FastAPI 模式**：`index.html` 头部内联脚本检测 `location.protocol !== 'file:'` 时注入 `<base href="/static/">`，使相对路径 `css/style.css`、`js/app.js` 解析到 `/static/...`（后端只挂载了 `/static`）。
- **file:// 模式**：不加 base，相对路径直接可用；API 失败时静默降级（候选用内置模板、运行用离线结果提示）。

---

## 2. 关键函数（app.js 内部）

| 函数 | 职责 |
|---|---|
| `api(path, opts)` | fetch 封装（相对 `/api` 路径、JSON、错误抛出 `detail/error`） |
| `addNode(kind, tmpl, x, y)` | 创建节点 → 渲染 → 选中 → 触发 `generateForNode` |
| `generateForNode(node)` | 置 `generating` → `POST /api/module/generate` → `showPicker`；失败/空候选 → 内置模板回退 |
| `buildGenCtx(node)` | 生成上下文：`plan`=最近的 root/plan 祖先标题，`upstream`=直接上游节点标题列表 |
| `showPicker(node, cands, fallback)` | 候选选择弹层（推荐项高亮 + 「推荐」徽标），点击即 `applyCandidate` |
| `applyCandidate(node, cand)` | 写回 title/description/prompt/recommended，置 ready，刷新相连连线语义 |
| `updateEdgeSemantics(edge)` | 调 `window.__wfEdgeSemantic`（默认 `/api/edge/semantic`），回填 `edge.data{intent,label,description,injection}` |
| `updateEdges()` | 重绘所有连线 path + 中点标签（按源节点类型着色、选中加粗、箭头 marker） |
| `startDragNode / startConnect / startTmplDrag` | 节点拖拽 / 端口建线（临时虚线跟随） / 抽屉模板拖入画布 |
| `renderPanel()` | 右侧信息面板（节点详情 / 连线语义 / 空态） |
| `saveSettings / testSettings / refreshConfigBadge` | 设置保存、连接测试、徽标刷新（has_key && model） |
| `serialize / renderFlow / saveCanvas / loadLastFlow` | 画布数据序列化、载入渲染、保存、启动自动加载 |
| `defaultRun / setRunState / setRunResults` | 内置简易运行；虚线开关（SVG `run-active` 类）；运行结果回填节点（✓/运行中/评分） |
| `on / emit` | 轻量事件总线（供 edges.js 订阅） |

### 关键状态
`state = { nodes, edges, selectedNodeId, selectedEdgeId, runState, drawerOpen, flowId, flowName }`；
节点字段：`{ id, kind, title, description, prompt, recommended, x, y, status('generating'|'ready'), run }`；
连线字段：`{ id, source, target, data{ intent, label, description, injection, pending } }`。

---

## 3. 与 js/edges.js 的 `window.__wf` 契约衔接点

`app.js` 末尾暴露全局 `window.__wf`（edgess.js 加载时自动继承），并提供两个可覆盖钩子：

```js
window.__wfRun = null;          // 运行入口：edges.js 可整体覆盖（含逐节点动画、结果面板等）
window.__wfEdgeSemantic = null; // 连线语义：edges.js 可覆盖（如追加 plan 上下文）
```

### `window.__wf` 完整接口

- **数据/只读**：`getNodes()`、`getEdges()`、`getNode(id)`、`getEdge(id)`、`getSelectedNode()`、`getSelectedEdge()`、`getFlowData()`（=serialize）、`getPlanContext(node)`、`getCanvasRect()`、`clientToCanvas(cx,cy)`
- **节点**：`addNode(kind, tmpl, x, y)`、`removeNode(id)`、`selectNode(id)`、`deselectAll()`、`renderNodes()`
- **连线**：`addEdge(sourceId, targetId)`（内部自动触发语义生成）、`removeEdge(id)`、`selectEdge(id)`、`updateEdges()`、`refreshEdgeSemantics(edge)`
- **候选**：`generateCandidates(kind, ctx)`（→Promise<candidates>）、`applyCandidate(node, cand)`
- **运行状态**：`setRunState(bool)`（虚线开关）、`setRunResults(results)`、`clearRunResults()`、`run()`（=点击运行按钮）
- **设置**：`openSettings()`、`closeSettings()`、`refreshConfigBadge()`
- **保存/加载**：`saveCanvas()`、`loadFlow(flow)`
- **事件**：`on(name, cb)`、`emit(name, data)`
  - 事件名：`ready / node-added / node-removed / node-moved / node-updated / node-selected / edge-added / edge-removed / edge-selected / edge-updated / run-requested / run-state / flow-loaded / canvas-saved / selection-cleared`
- **工具/DOM**：`api(path, opts)`、`toast(msg, type)`、`el`（DOM 引用缓存）、`KINDS`、`constants{NODE_W, NODE_H}`

### edges.js 推荐做法
```js
window.__wfRun = async function () {
  const { getNodes, getEdges, setRunState, setRunResults, toast } = window.__wf;
  setRunState(true);
  const d = await window.__wf.api('/api/flows/run', { method: 'POST', body: {
    nodes: getNodes().map(n => ({ id: n.id, kind: n.kind, title: n.title, prompt: n.prompt })),
    edges: getEdges().map(e => ({ id: e.id, source: e.source, target: e.target, data: e.data || {} }))
  }});
  setRunResults(d.results);      // 节点显示 ✓/运行中/评分
  setRunState(false);            // 恢复实线
};
window.__wf.on('node-updated', (n) => { /* 标题变化后的自定义处理 */ });
```
> 运行请求体与后端 `POST /api/flows/run` 完全匹配（nodes 含 id/kind/title/prompt；edges 含 source/target/data.injection）。

---

## 4. 验证记录

- `node --check web/js/app.js`、`node --check web/js/edges.js` 均通过（node v24）。
- `scripts/smoke-app.cjs`（Node + 最小 DOM stub，加载真实 app.js）3 场景全绿：
  - **A 正常流程**：addNode → 弹层显示 → applyCandidate → 连线 → 语义生成 → 默认运行调 `/api/flows/run` → 保存/加载 → 删除；
  - **B 离线回退**：module/generate 失败 → 内置模板弹层 + 「模型未配置或离线」提示；
  - **C 钩子覆盖**：`window.__wfRun` / `window.__wfEdgeSemantic` 被覆盖后均生效。
- 真实后端联调（8010 端口既有 uvicorn 实例）：`GET /` 200、`/static/css/style.css` 200、`/static/js/app.js` 200、`/api/health` ok。

### 过程中发现并修复的 bug
`addNode` 曾先设 `status:'generating'` 再调 `generateForNode`，后者守卫 `if(status==='generating') return` 导致**候选生成永不触发、选择弹层永不弹出**。已改为 addNode 设 `status:'ready'`，由 `generateForNode` 负责置 generating（冒烟测试捕获，修复后 `/api/module/generate` 正常调用）。

---

## 5. 已知限制（供后续迭代）

1. **固定节点尺寸**：节点 224×92px（`NODE_W/NODE_H` 常量与 CSS 同步），端口位置按常量计算；若未来支持可变尺寸需改为实时测量（`offsetWidth/Height`）。
2. **无 pan/zoom**：画布 1600×1200 可滚动，未实现缩放/平移；节点可拖到任意坐标（含负值）。
3. **候选生成期间节点不可重复生成**：`status==='generating'` 会忽略再次点击「重新生成」，需等弹层关闭。
4. **自动加载最近流程**：仅启动时静默加载 localStorage 里的 `wf:lastFlowId`（或最后一个保存），无手动"载入列表"UI。
5. **设置面板 API Key**：为安全起见表单不回填已保存密钥（留空=保持不变），测试连接前会先静默保存表单。
6. **运行虚线自动恢复**：默认实现在运行结束后 1.4s 恢复实线（edges.js 覆盖后可自行控制）。
7. **并发协作提示**：`web/js/edges.js`（43KB）与 `web/css/edges.css`（8KB）由并发子代理创建，且其曾修改过 index.html/app.js/style.css；本报告核查时 `window.__wf` 契约完整、edges.js 委托 app.js 的 addEdge/updateEdges/selectEdge 且无自己的端口监听（无双重建线冲突）。后续修改 web/ 下文件前请与对应负责人协调，避免互相覆盖。

---

## 变更日志

- 2026-08-31：前端核心（index.html / style.css / app.js）交付；新增 scripts/smoke-app.cjs；修复 addNode 候选生成短路 bug；补充 /static base 兼容脚本。
