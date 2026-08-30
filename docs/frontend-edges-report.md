# dsh-workflow-studio — 前端「连线语义 + 运行可视化」模块实现报告

> 对应文件：`web/js/edges.js`（实现）+ `web/css/edges.css`（样式）+ `web/index.html`（追加 edges.css 引入）。
> 配套：`web/js/app.js`（画布核心，并行子代理构建）、`docs/API.md`（REST 规范）、`backend/routers/flows.py`、`backend/llm.py`。

---

## 1. 分工与协作模型

app.js 已完整实现画布核心：节点/连线存储、连线渲染（`#edge-svg` 内 `.wf-edge` 路径 + `#edge-labels` 标签）、端口拖拽建线（`addEdge`）、连线语义自动生成（`POST /api/edge/semantic` + 离线兜底）、右侧 `#panel-edge` 语义面板、事件总线、`#btn-run → clickRun`。

app.js 顶部注释与 `#btn-run` 的 title 均明确约定「**由 js/edges.js 接管 `window.__wfRun` 增强运行**」。因此本模块的定位是**运行接管 + 契约胶水 + 运行可视化**，不重复实现连线本体，未改动 app.js 与 backend。

## 2. window.__wf 契约

app.js 暴露 `window.__wf`（数据快照、节点/连线操作、运行状态、保存/加载、事件总线 `on/emit`、`api`、`toast`、DOM 引用等）。edges.js 在 app.js 之后加载，**只补充、不覆盖** app.js 已有能力：

| 接口 | 实现方 | 行为 |
|---|---|---|
| `window.__wfRun` | **edges.js** | 运行入口。app.js `clickRun` 检测其为函数时调用；本模块设为 `runFlow`（含逐节点动画 + 结果气泡 + 出边流动状态） |
| `__wf.getNodes()` / `__wf.getEdges()` | app.js | 只读快照；edges.js 直接使用（仅当 app.js 缺失时用 DOM 兜底 `getNodesFallback`） |
| `__wf.onNodeFromPort(sourceId, targetId)` | edges.js（委托） | 委托 `__wf.addEdge`；app.js 内部自动调 `/api/edge/semantic` 生成语义 |
| `__wf.renderEdgeLabels()` | edges.js（委托） | 委托 `__wf.updateEdges()` 重绘连线与标签 |
| `__wf.showEdgePanel(edgeInfo)` | edges.js（委托） | 委托 `__wf.selectEdge(id)` → app.js 在 `#panel-edge` 显示 label/description/injection |
| `__wf.hideEdgePanel()` | edges.js（委托） | 委托 `__wf.deselectAll()` |
| `__wf.redrawEdges()` | edges.js（委托） | 委托 `__wf.updateEdges()` |
| `__wf.importEdges(edges)` | edges.js | 按 source→target 去重，缺失的连线经 `__wf.addEdge` 补入（自动触发语义） |
| `__wf.visualizeRun(results, outputs)` | **edges.js** | 运行回填：先清痕，再按拓扑顺序播放松弛动画 + 结果气泡（外部拿到 results/outputs 可直接调用） |
| `__wf.runFlow()` | **edges.js** | 一键运行：读画布 → `POST /api/flows/run` → `runVisualization` |
| `__wf.clearRunState()` | **edges.js** | 清空流动/已流动状态、呼吸灯、气泡，并调用 `__wf.clearRunResults()` 重置 app.js 节点 run 数据 |

事件：edges.js 复用 app.js 的事件总线，运行期间广播 `run-start` / `node-progress`（`{id,status,result}`）/ `run-end`（`{results,outputs}` 或 `{error}`）。

## 3. 连线语义如何实现

- 建线（端口拖拽）由 app.js 完成：`startConnect` → `addEdge(sourceId, targetId)`（同源同目标去重）。
- `addEdge` 随即调用 `updateEdgeSemantics`：调 `POST /api/edge/semantic`，body 为 `{from_module:{kind,title}, to_module:{kind,title}}`，响应 `{intent,label,description,injection}` 写入 `edge.data`（失败时 app.js 内置离线模板兜底，**保证任何情况下连线都有语义、不报错**）。
- 连线中间显示 `data.label` 标签（app.js 渲染于 `#edge-labels`）；点击连线或标签 → `selectEdge` → 右侧 `#panel-edge` 显示「连接 / 标签 / 意图 / 说明 / 注入方式」+ 删除按钮。
- `window.__wfEdgeSemantic` 为 app.js 预留的语义生成钩子（默认 null 走内置实现），edges.js 不覆盖。

## 4. 实线 / 虚线规则（硬性）

1. **平时（未运行）连线一律实线**：app.js 渲染的 `.wf-edge` 默认 solid 描边。
2. **虚线 + 流动动画只在运行中的「流动中」状态出现**：edges.js 对某条出边加 `.is-flowing` 类 → `#edge-svg .wf-edge.is-flowing` 应用 `stroke-dasharray: 10 8` + `@keyframes wf-edge-flow`（`stroke-dashoffset` 循环），颜色高亮 `#00C2FF` + 辉光。
3. **运行结束恢复实线，但用「已流动」样式区分**：`.is-flowed` → 实线 + `#wf-edge-grad` 渐变描边（蓝→青，由 edges.js 向 `#edge-svg` 注入 linearGradient defs）+ 柔光，**不使用虚线**。
4. **拖拽预览线也使用实线**：app.js 的 `#temp-edge`（class `wf-edge-temp`），edges.css 只补充圆头与辉光，不加虚线。
5. `prefers-reduced-motion` 下禁用动画（保留虚线标记但去掉流动）。

## 5. 运行可视化如何实现

`runFlow()` 流程：

1. 读 `__wf.getNodes()` / `__wf.getEdges()`；画布为空则 toast 提示。
2. 构造 payload：`{nodes:[{id,kind,title,prompt}], edges:[{source,target,data}]}`（`data.injection` 会随运行注入下游，见 `backend/routers/flows.py`）→ `POST /api/flows/run`。
3. `clearRunState()` 清理上一次痕迹（含 `__wf.clearRunResults()`）。
4. 客户端拓扑排序（与后端 `_topo` 一致），按顺序逐节点播放：
   - 节点：加呼吸灯 `.wf-run-ring` + 节点本体显示「运行中…」（复用 app.js 的 `.wf-node-spinner`）→ 650ms；
   - 节点完成：呼吸灯移除、`wf-node--done`、结果气泡 `.wf-node-bubble` 挂到节点下方（summary + 分数徽标（0~1 → 百分制、绿/蓝/橙三档）+ detail 可点击展开），并把结果写入 app.js store（`storeNode.run = result`，节点被重渲染时显示 run chip）；
   - 该节点所有出边：先 `.is-flowing`（虚线流动）750ms → 再 `.is-flowed`（渐变实线）。
5. 全部完成：toast「运行完成 ✓」+ `run-end`；任一步异常：toast 错误 + `run-end({error})`。全程 `#btn-run` 忙碌态（`is-running` + disabled）。

`visualizeRun(results, outputs)` 供外部直接回填（先清痕再播放），带 `state.running` 重入保护。

## 6. 与 app.js 的衔接细节

- **加载顺序**：`index.html` 中 `<script src="js/app.js" defer>` 在前、`<script src="js/edges.js" defer>` 在后；app.js 顶层已置 `window.__wfRun = null`，edges.js 在 DOMContentLoaded 中覆盖为 `runFlow`，用户点击时必然取到最新实现。
- **DOM 复用**：连线路径定位通过 `#edge-svg` 内 `.wf-edge-hit[data-edge="id"]` 的前一个兄弟元素（`.wf-edge` 可见路径）——这是唯一与 app.js `updateEdges` DOM 结构的耦合点。
- **静态路径**：`index.html` 通过 `<base href="/static/">` 让相对资源路径在 FastAPI 挂载下解析到 `/static/`（web/ 目录）；edges.css 已加入 `<link>`。
- 本模块**未修改** `web/js/app.js`、`web/css/style.css` 与 `backend/*`。

## 7. 验证记录

- `node --check` 语法通过（edges.js / app.js）。
- 后端 8010 实测：`GET /`、`/static/js/edges.js`、`/static/js/app.js`、`/static/css/edges.css`、`/static/css/style.css` 均 200；`POST /api/edge/semantic` 返回 `intent=artifact` + label/description/injection；`POST /api/flows/run` 按拓扑返回逐节点 `results`（status/score/summary）与 `outputs`。
- DOM 桩冒烟测试（`C:\Users\Public\wf-edges-smoke.js`，20 项断言全绿）：`__wfRun` 接管、平时实线、运行中 `is-flowing`（虚线）、结束后 `is-flowed`（实线渐变、无虚线）、`#btn-run` 忙碌态、结果气泡与分数、store run chip 写入、fetch payload 结构、重跑先清理。

## 8. 已知限制

1. **DOM 结构耦合**：`edgePathEl` 依赖 app.js `updateEdges` 的固定结构（`.wf-edge-hit[data-edge]` 前一个兄弟为 `.wf-edge` 可见路径）。若 app.js 调整该结构（如加包裹层、改属性名），需同步 edges.js。
2. **运行期间若用户拖动节点**：app.js 会重绘连线（`updateEdges`），本模块加在路径上的 `is-flowing/is-flowed` 类会丢失；运行结束后已流动的连线需重跑一次或手动触发 `clearRunState`/`visualizeRun` 恢复。
3. **气泡生命周期**：结果气泡挂在节点 DOM 上，app.js 触发 `renderNodes`（新增/删除节点、应用候选、清空运行结果等）时会随 `innerHTML` 重建而消失；节点 run 数据已写入 store，重渲染后本体 run chip 仍可见，但气泡详情需重跑。
4. **顺序动画耗时**：每个节点固定 650ms + 每条出边 750ms，长流程总时长线性增长（未做并行/加速，可后续按需优化）。
5. **非运行虚线红线**：若 app.js 未来给 `#edge-svg` 加 `run-active` 类，style.css 的全局虚线规则会被触发——本模块刻意不使用 `run-active`，仅用逐边类，请勿混用。
6. **面板为 app.js 实现**：连线详情面板由 app.js `renderEdgePanel` 渲染（含 label/description/injection/删除），本模块不重复实现；若需「重新生成语义」按钮需扩展 app.js。

## 9. 修改文件清单

| 文件 | 变更 |
|---|---|
| `web/js/edges.js` | 新建：运行接管 + 契约包装 + 运行可视化 |
| `web/css/edges.css` | 新建：虚线流动动画、已流动渐变、呼吸灯、结果气泡、按钮态、reduced-motion |
| `web/index.html` | 追加 `<link rel="stylesheet" href="css/edges.css">` |
| `README.md` | 变更日志追加一行 |
