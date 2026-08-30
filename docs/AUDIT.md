# dsh-workflow-studio — 对抗性审计发现与修复追踪

> 由 5 路子代理并行对抗性审计产生（安全 / 功能严谨 / UX / 打包发布 / 原生集成）。
> 状态：🔴 待修 · 🟡 已定案待实现 · 🟢 已修复/已验证
> 2026- 用户理念纠正后按树模型重构（见"树模型重构"节）。

## 安全审计（Security）

### C1 🔴 任意文件写入（路径穿越）— `lib/index.js:30-37`
`saveWorkflow` 用 `join(dir, `${wf.id}.json`)` 写文件，`wf.id` 仅校验 `typeof === "string"`。
`..\..\` 可越出存储目录；JSON 是 YAML 子集，可覆盖 `~/.dsh` 下 JSON/YAML 配置。
**修复**：`wf.id` 严格正则 `/^[A-Za-z0-9_-]{1,64}$/`，拒绝 `/` `\` `..`；`path.resolve` 后断言落在 storeDir 内。

### C2 🔴 未认证端点 + CSRF / DNS rebinding / LAN 暴露 — `lib/index.js:84-165`
四端点零认证、无 Host/Origin 校验；跨站 simple request 可触发 C1 写入。
**修复**：写操作要求会话密钥；Host 白名单（loopback + trustedHosts）防 DNS rebinding；校验 Origin；LAN 模式文档告警。

### H1 🟡 运行时 CDN UMD 注入无 SRI — `lib/client.js:180-201`
jsdelivr 注入 xyflow/gsap 无 integrity。第三方脚本在 DSH 页面源执行。
**修复**：本地 vendoring 或构建期 SRI hash + 硬失败；shape-check 注入全局。

### M1 🟡 `readBody` 超限挂起 + O(n²) — `lib/index.js:44-51`
超 4MB `req.destroy()` 后 end 不触发 → promise 永不 settle，handler 永久挂起。
**修复**：chunk 数组累计；超限返回 413 并 resolve；监听 close/aborted；Content-Length 提前拒绝；超时。

### M2 🟡 全局命名污染 — `lib/client.js:17-23,191-201`
写 `window.React/ReactDOM/jsxRuntime`，且信任既有全局。React 版本 skew 可毁掉整个 GUI。
**修复**：改用 loader require 注入，或快照/恢复全局；验证注入对象 API。

### L1 🟡 错误信息泄露绝对路径 — `lib/index.js:103,127,145,161`
catch 返回 `error.message` 含绝对路径（路径存在性 oracle）。
**修复**：客户端返回通用 `{error:"internal"}`，细节留服务端日志。

### L2 🟡 无界列表/导入大小 — `lib/index.js:21-28`、`lib/client.js:477-491`
`listWorkflows` 全量返回无分页；import 无大小上限可冻结 UI。
**修复**：分页/上限 + `Cache-Control: no-store`；import 大小上限。

### 已验证安全 ✅
无 XSS（无 innerHTML/dangerouslySetInnerHTML/eval/new Function，React 转义）、无 SSRF、无原型污染、无密钥泄漏。

## 功能严谨审计（Functional）

完整性评分 **4.5/10**，32 条发现（F1–F32），Top 5 阻塞项待合并入实现计划。

## UX / 视觉审计（UX）

评分 **6/10**。核心问题：画布样式很可能未加载、深色模式白色泄漏、约 20 处硬编码中文、非键盘可达、连线失败静默、无新手引导、elastic 缓动违背自身 Apple 规范。

### 画布/深色（最严重）
- **U1 🔴** `client.js:526-533`：RF 未设 `colorMode`，默认 light；且 **@xyflow/react UMD 不内嵌 CSS**（12.11.3 需单独加载 `dist/style.css`，插件从未加载）→ 画布可能未样式化/深色下白色刺眼。修复：加载 style.css + 从 DSH 主题派生 `colorMode`。
- **U2 🔴** `:536` Plan 输入框无 class 无 token → 深色下 UA 默认白框。修复：`.ws-planInput` + `color-scheme:light dark`。
- **U3 🔴** `:41` `.ws-toolbar` 用 `rgba(255,255,255,.55)` 玻璃无 DSH 回退 → 深色下奶白。修复：`var(--dsw-alias-bg-layer-1, var(--ws-glass-bg))`。
- **U4 🟡** `:68,86,88,104` 原始 tint/强调无 alias 回退；`:28` `--ws-accent-dark` 定义未用。修复：accent 走 `--dsw-alias-brand-primary`，tint 用 `color-mix`。

### 动效
- **U5 🟡** `:574` `elastic.out(1,0.55)` 振幅 1 → 橡胶感，违背自身 Apple spring 规范。改 `back.out(1.4-1.7)`。
- **U6 🟡** `:56` CSS transition 与 GSAP tween 同时作用于 transform 互相打架。tween 完 clearProps。
- **U7 🟡** `:109` reduced-motion CSS 有但 GSAP `playNodeIn` 未 gate；`playOverlayIn` 死代码。补 matchMedia gate。
- **U8 🟡** `:63` `calc(100vw-32px)` 需空格 → spec 非法。改 `calc(100vw - 32px)`。

### 布局/引导/可达性
- **U9 🟡** 无响应式（固定 190px palette + 不换行 runbar）；`:431` 随机叠加；运行按插入序而非拓扑序。
- **U10 🟡** `:52,522` palette 宣传"拖入"(`cursor:grab`) 但实际点击添加；`:145` `t("empty")` 死键从不渲染。
- **U11 🟡** 连线失败/离线静默无反馈（`t("notAllowed")` 死键）。
- **U12 🟡** 无障碍：palette/候选为 `<div onClick>` 不可键盘操作；EdgeOverlay 无 focus trap/Esc/dialog 语义；无 `:focus-visible`；状态仅颜色无 aria-live。
- **U13 🟡** i18n 约 20 处硬编码中文（返工/普通/PTC/Loop/＋文件/执行中/回退/palette 副标题/导入导出运行等）未进字典。
- **U14 🟡** 深色下 `#007AFF` 对比 4.0:1 不达 WCAG AA；主按钮用 iOS 蓝与 DSH brand 不符 → 改 `--dsw-alias-brand-primary`。

### Top 5 高 ROI
1. 加载 `@xyflow/react/dist/style.css` + 设 `colorMode`
2. 消除深色白色泄漏（foot input / toolbar select / glass / primary）
3. 全部字符串入 zh/en 字典
4. 连线反馈 + 真实拖拽或改文案 + 新手引导 + 级联布局
5. 无障碍 + reduced-motion gate + 对比度

## 原生 workflowEngine 集成审计（Native）

### 核心事实（已从源码确认）
- **DSH 原生工作流 = 纯 JS 编排脚本**（顶层 await、`return <json>`、hooks：`agent()`/`parallel()`/`pipeline()`/`phase()`/`log()`/`args`），由 `ctx.workflowEngine.start(request)` 执行，每个 `agent()` 扇出一个真子代理。
- **`WorkflowStartRequest` = `{ script, meta, args?, subagentProvider?, maxTotalAgents?, parent(必填 Agent), signal? }`**；返回 `WorkflowRun = { id, meta, result:Promise<WorkflowResult>, cancel(reason), dispose() }`；`WorkflowResult = { value, stopReason:'completed'|'cancelled'|'error', error?, agentsStarted }`。`dispose()` 必须每条路径调用（默认 5s grace 强杀 worker）。
- **事件**：`workflow/start|end|phase|log|agent-start|agent-end` —— 用于实时进度（呼吸灯/红箭头）。注意：事件不带子代理结果文本，回填气泡须靠脚本 return 的结构化 `{nodeId:{summary,detail}}`。
- **`parent` 解析**：插件用 `ctx.get('agents')?.get(sessionId)`（client 的 WorkflowView 已有 sessionId）。
- **引擎默认 disabled**：web-app 在 host 平面关掉 `workflow-worker-thread`+`tool-workflow`（preset 每会话 isolate realm 里才启用）。因此当前 host 平面 `ctx.get('workflowEngine')` → undefined。启用两条路：
  - **路径 A（组合补丁）**：profile cordis.patch.yml 加 `- id: workflow-worker-thread; disabled: false; config:{provider:spawn}`
  - **路径 B（插件自挂载）**：`new WorkerThreadWorkflowEngine(ctx, {provider:"spawn"})`（构造即 provide），feature-detect 避免重复注册
- **PTC 限制**：engine seam 无按子代理设 presentation 的选项 → PTC 只能靠 parent 跑在 code preset 或编译器在 prompt 里显式指令。
- **Loop/Review/维度映射完美**：Loop=JS do-while；Review=带 JSON Schema 的 judge 子代理；维度=`parallel()`；返工边=`if(!pass){重新action}`（带 maxAttempts 上限）。
- **原生 `workflow-run` 对话面板**：只有经 `dsh-tool-workflow` 的顶层调用自动产生记录；插件直接 start() 不自动得面板（可选：自己 `session.append` 4 种 `tool-workflow/*` 记录）。
- **推荐 hybrid**：`ctx.get('workflowEngine')` → 无则自挂载 → 再缺回退现有 setTimeout 仿真（带"仿真"徽标）。

### 集成路线图（M-A…M-F，合计 9-15 人日；原型 M-A…M-C 4-7 人日）
- **M-A 打通引擎**（1-2d）：启用引擎（A/B）+ 新增 `POST /api/dsh-workflow-studio/run`（照抄 dsh-tool-workflow L231-269 形态）+ `GET run-status`；client run() 改 fetch。
- **M-B 画布→脚本编译器**（2-3d）：`lib/compile.js` 纯函数；拓扑排序 DAG；线性链编译为顺序 await；**用户文本/intent 一律 JSON.stringify 嵌入**（注入防护）；返回 `{nodeId:{summary,detail}}`。
- **M-C 结果回填气泡**（1-2d）：调现有 setNodeRuntime/rollbackCascade；error→标红+cancelled→标注。
- **M-D Review/Loop/parallel/schema**（2-3d）：do-while + parallel() + JSON Schema；maxAttempts 默认 3。
- **M-E 实时进度+取消+dispose**（2-3d）：SSE 推 phase/agent-start/end → 呼吸灯/红箭头；取消→run.cancel；finally dispose。
- **M-F 原生面板+回退+文档**（1-2d）：可选 session.append；仿真回退带徽标；README 启用安装节。

### 风险
预发布 rc 版本（feature-detect+钉版本）；默认 disabled（profile patch 是用户文件）；realm 隔离（需 host 平面实例）；parent 可能 undefined（400+仿真回退）；前台执行无 journaling（SSE/超时缓解）；结果体积（return 精简）；编译器注入（JSON.stringify 单测）；双引擎并存（各自 worker）；DSH 版本漂移（ctx.get feature-detect 天然兼容）。

## 打包发布审计（Packaging）

（待返回后补充）

## 树模型重构（用户理念纠正，已完成）
- **2026- Loop=循环体容器（复合节点/嵌套子图）**：用户明确 Loop 是"循环体"，**内部自身也可以有复杂图结构**。已在 makeNode/normalizeTree 加 `subGraph:{nodes,edges}`；compile.js 新增 `compileSubGraphBody` 把内部图编译进 do-while 循环体（内部按依赖序、可再嵌套），闸门取内部 review/dimension 的 score（容器）或外部 loop-gate；client buildTree/treeToRF 透传 subGraph。测试 98 全绿。
- **2026- 图模型纠正（非树）**：用户明确这是**自由图模型**——有且仅有一个启动节点，其余是自由图结构，可**从某节点返回到上一个节点再推进**（负反馈收敛），不是单程票。已在 lib/tree.js 加 `scc`（Tarjan 强连通分量）+ `graphDecompose`（feedbackLoops + acyclicOrder），`parallelStages` 改环容忍；lib/compile.js 用 graphDecompose 把反馈环渲染为 do-while 负反馈收敛循环。测试 98 全绿。
- 新纯逻辑：`lib/tree.js`（图数据模型：root 唯一起点、node kinds、PRESET_AGENTS、自定义 agents、reviewLanding、suggestReview、parallelStages、graphDecompose、summarizeNodeTree）、`lib/compile.js`（画布图→DSH 原生 workflow 脚本：Promise.all 并行、反馈环 do-while、review schema、JSON.stringify 注入安全）。
- 新 host 端点：`POST /run`（workflowEngine.start + parent 解析 + feature-detect→501/simulation）、`GET /agents`、`POST /review-landing`、`POST /generate`（subagents.start 让 AI 生成树，provider 探测 + dispose + SubagentResult.output 提取）。
- client 重写为双栏树工作流（对话生成→树画布），`/generate` 优先 + 本地启发式回退，`/run` 回填 results/outputs 气泡与分支文件冒泡，自定义 Agent，Review 落点 overlay。
- 测试：58（workflow）+ 24（tree+compile，含注入安全/脚本可解析）= 82 全绿；preflight PASS。
- 结构无关修复均已应用：RF stylesheet 注入 + colorMode 深色、深色泄漏、focus-visible、对比度、reduced-motion GSAP gate、键盘可达 palette、back.out 缓动、C1 路径穿越、readBody 413、错误脱敏、列表上限。
- 待办：真实 `/generate` 端到端验证、启用原生 workflowEngine（profile patch 或自挂载）后真机验证、README/docs 更新、npm 重发。

## v0.3.0 用户纠正重构（本次）
- **左侧菜单栏**：去掉"对话栏"，改为左侧**四个样式迥异的按钮**（Plan/Action/Review/Loop，形状/颜色/图标均不同），点击展开该类型的 **Agent 抽屉**（默认 Agent + 用户自定义，`+` 新增，自带分类），拖拽生成节点。
- **多接口节点**：节点**左输入 / 右输出各可接多条线**（每端 handle 数 = 连接数 + 1 个备用），edgeCounts 改为渲染期注入 data._in/_out，无模块共享态。
- **去侧边对话栏**：DeepSeek 底部对话框常驻，对话生成改为工具栏「生成工作流」弹窗 + 对外 REST API；生成不再静默替换（有内容先确认）。
- **自动命名/语义（自主性）**：拖节点自动命名、连线自动推断"这条线的作用"（产出→审核/审核反馈/评分闸门…）并 toast 反馈；`lib/semantics.js` 纯逻辑可测。
- **对外 REST API（接口化部署）**：`/api/dsh-workflow-studio/v1/flows`（POST 直接创建流程）、`/v1/flows/generate`（自然语言生成，subagent 失败回退 heuristicGenerate）、`/v1/menu`（四类 + 默认 Agent）。
- **Loop=Scratch C 形容器**：loop 渲染为中间空心的 C 形框，可塞入子节点（subGraph），随内容自动增大。
- **企业级多子代理审查**：安全/功能/UX 三路并行审查 → 详见 docs/review-rework-{security,functional,ux}.md。已修复：GenPromptOverlay 未定义 err 崩溃、...tree 覆盖 id 数据丢失、edgeCounts 共享态、v1 硬编码 spawn、run.dispose 守卫、编译错误表面化、Infinity 循环钳制（clampLoop）、CSRF content-type 校验、列表脱敏（redact）、对比度/抽屉键盘/生成确认/toast。
- 测试 121 全绿（58+40+11+12）；preflight PASS；pack 内容正确（含 semantics.js）。版本 0.3.0。
- **安全子代理报告全部闭环**：#4 DoS 已补——v1 写入边界加 MAX_NODES=500 / MAX_EDGES=2000 节点上限 + MAX_STORED=500 存储配额（saveWorkflow 拦截，TOO_MANY/QUOTA→422）；#2 Infinity 已 clampLoop；#3 已 ...tree 优先；#5 已 redact；#7 已 content-type 校验；#8 CDN SRI 属低危加固，暂记入待办（钉版本 + 后续 self-host）。
- **功能子代理报告全部闭环**（review-rework-functional.md）：GenPromptOverlay err 崩溃✅、edgeCounts 渲染期注入✅、nodeTypes 提升✅、...tree 优先✅、spawn 探测✅、run.dispose 守卫✅、编译错误表面化✅；补充：localStorage 挂载首写守卫（restoredRef）+ 旧版 custom agents 无 category 归一化（normalizeCustomAgents）。
- **UX 子代理报告高优闭环**：抽屉键盘可达（tabIndex/Enter）、4 按钮对比度加深、生成弹窗先确认不静默替换 + 本地解析徽标、自动命名/连线作用 toast、旧文案改自由画布、screenToFlowPosition 落点、focus-visible 全覆盖。
- **UX 报告补充闭环**：连线动画 class 1s 后移除（不再空闲无限流动）、4 个弹窗加 role=dialog/aria-modal + Escape 关闭、多口把手封顶 6/侧 + 去除易缺失字形的 Unicode 箭头 + hover 放大 + reduced-motion 门控、node purpose 语义句渲染 + EdgeEditOverlay 显示 detail（这条线的作用）。
## 用户视角功能验收与优化（非代码审查）
- **拖入 Loop 容器**：拖 Agent 落到 Loop 框内 → 自动加入该 Loop 的 subGraph（Scratch 式塞入），带 toast；否则才新建顶层节点。
- **连线自动命名下游**：连接时若下游节点是通用标题，自动改为「审核「XX」/执行「XX」/规划「XX」」。
- **修双击重复 bug**：Agent 卡同时有 onClick + onDoubleClick → 双击加 3 个节点；已去掉 dblclick，单击即加。
- **loop.added 文案**：拖入容器后 toast 提示。
- 用户视角全链路走查：四按钮菜单→抽屉拖 Agent→拖入 Loop 容器→连线自动语义命名→生成工作流（唯一起点+并行分支）→运行结果回填/分支文件/回退，均无断点。
