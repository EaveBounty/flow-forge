# dsh-workflow-studio

> **独立前端项目**（FastAPI 后端 + 根路径 HTML 前端）。工作流智能编排画布：**一切由大模型根据流程上下文自动生成，用户只做选择，绝不打字。**

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![python](https://img.shields.io/badge/python-%3E%3D3.10-blue)](#要求)

## 定位与核心理念

本项目是一个**独立可运行**的工作流编排工具，不再作为 DSH 插件 bundle，而是**后端服务 + 浏览器前端**，DSH 或任何调用方通过其 REST API 驱动智能构建。

**核心理念（用户反复强调，必须遵守）**：
- **用户绝不打字**：画布上拖入的每个模块、连上的每条线，都由大模型根据流程上下文**自动生成候选描述**，用户只从多个候选中**挑一个**（标出推荐项）。
- **连线自动语义**：连线自动生成「这条线的作用 + 两模块结合的作用 + 如何注入下一个模块的 Agent」，用户查看/确认。
- **虚线只在运行后出现**：平时用实线表示结构关系；运行后才用虚线+流动动画表示数据在传输。
- **运行必须真实可执行**：未配置模型时自动回退内置模板，绝不报错。

## 快速开始

```bash
# 安装依赖
pip install -r requirements.txt

# 启动（根路径渲染 HTML 前端）
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8010
```

打开 `http://127.0.0.1:8010/` 即可使用画布。右上角「设置」填入模型厂商 / 模型 / API Key 后走真实大模型；不填则用内置模板（仍可完整使用）。

## 目录

- `backend/` — FastAPI 后端（`main.py` 入口；`llm.py` 生成逻辑；`settings.py` 设置存储；`routers/`）
- `web/` — 前端（`index.html` + `css/` + `js/app.js` 画布核心 + `js/edges.js` 连线/运行）
- `docs/API.md` — REST API 规范（供 DSH 调用）
- `data/` — 本地设置与流程存储（已 gitignore）

## REST API（摘要）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET  | `/` | 渲染前端 |
| GET/PUT | `/api/settings` | 读取/保存模型设置 |
| POST | `/api/settings/test` | 测试模型连接 |
| POST | `/api/module/generate` | 生成模块候选 `{kind, ctx}` → `{candidates:[{title,description,prompt,recommended}]}` |
| POST | `/api/edge/semantic` | 生成连线语义 `{from_module, to_module}` → `{label, description, injection}` |
| POST | `/api/flows/run` | 运行流程 `{nodes, edges}` → `{results, outputs}` |
| GET/POST | `/api/flows` | 保存/加载画布 |

详见 [`docs/API.md`](docs/API.md)。

---

## 历史（旧版：DSH 插件）

> 早期版本为 DeepSeek Harness 插件（`lib/`、`cordis.patch.yml`、`package.json`），
> 后按用户要求彻底重构为独立前端项目。旧版代码保留在 `lib/`、`tests/` 等目录供参考，
> 新版入口为 `backend/main.py` + `web/index.html`。


- **对话生成流程**：在「工作流」标签内通过对话让 AI 从自然语言生成整张图（也可手工搭建，但不推荐）。
- **自由图 + 负反馈**：分支并行、反馈环收敛、Loop 循环体嵌套子图，不是"单程票"。
- **动态连线**：每条边由 AI 生成"要注入下游什么"；Review 落点语义自动猜测（拖到 Loop=评分闸门，否则=检查反馈）。
- **多对多 Review + 智能去重**：一个 Action 可接多个 Review，一个 Review 可接多个 Review（元审核）；接入多个 Review 时自动推测下一个不重复角度。
- **分支化输出**：每条分支可各自产出文件冒泡，不强制汇总成一个报告。
- **原生执行**：把图编译成 DSH 原生 workflow 脚本，节点真正派生子代理、分支并行执行（原生引擎缺失时自动回退仿真模式）。

> 设计文档：`docs/BACKGROUND.md`（背景）· `docs/RESEARCH.md`（调研/选型）· `docs/DESIGN.md`（完整设计）· `docs/AUDIT.md`（对抗性审计与修复追踪）。

## 功能

DSH Web 客户端 `conversation.view` 新增「工作流」标签（与 chat / trajectory 并列，不替换原生 UI）：

- **左侧菜单栏（四类，样式迥异）**：左侧是 **Plan / Action / Review / Loop 四个视觉完全不同的按钮**（不是改名克隆）。点击某个按钮 → 展开该类型的 **Agent 抽屉**：默认 Agent（预设）+ **用户自定义 Agent**（`+ 自定义` 新增，自带分类），拖拽 Agent 卡片到画布即生成对应节点。
- **多接口节点**：每个节点**左输入 / 右输出各可接多条线**（多 Handle），可自由汇聚/分叉。
- **自主性与智能性（自动命名）**：拖节点、连线时，系统**自动命名并写明这条线的作用**（源→目标语义推断：产出→审核、审核反馈、评分闸门…），画布上每条边都带语义标签。
- **无侧边对话栏**：DeepSeek 底部对话框常驻，侧边不再占一栏；对话生成改为工具栏「生成工作流」弹窗。
- **对外 REST API（接口化部署）**：`/api/dsh-workflow-studio/v1/flows`（外部直接 POST 创建流程）、`/v1/flows/generate`（自然语言生成）、`/v1/menu`（四类菜单 + 默认 Agent）——朋友/其它应用可通过接口创建流程，无需写死。
- **自由图模型**：唯一启动节点 + 自由图结构；分支并行、负反馈环、Loop 循环体（可嵌套复杂图）。
- **动态连线 + Review 落点语义**：连接即生成边语义；Review 拖到 Loop=评分闸门（够分放行否则循环），否则=该角度检查反馈。
- **多对多 Review + 智能去重**：接入多个 Review 自动推测下一个不重复角度（用尽后滚到元审核）。
- **运行时可视化**：节点呼吸灯、活动边红箭头流动、任务结果气泡（常显/悬浮）、逐节点回退（快照 + 依赖级联重置）。
- **Apple 级动效**：GSAP + CSS token 打底，spring 参数对齐 Apple HIG；深色模式 / reduced-motion 适配。

## 截图

> TODO：截图待真机验收后补。

## 要求

- DeepSeek Harness（web profile）
- Node.js ≥ 22.2

## 安装

```sh
# 从 npm 安装（scoped，公司组织 @eave_bounty）
dsh plugin --profile web add @eave_bounty/dsh-workflow-studio

# 从 GitHub 安装
dsh plugin --profile web add EaveBounty/dsh-workflow-studio

# 或从本地源码目录
dsh plugin --profile web add <path-to>/dsh-workflow-studio
```

重启 `dsh web`，会话页顶部出现「工作流」标签。

### 启用原生执行（可选）

原生并行执行依赖 DSH 的 `workflowEngine`。插件已内置**自挂载**（`/run` 时 feature-detect，缺失则动态实例化 `@deepseek-ai/dsh-workflow-worker-thread`），通常无需额外配置。若你的 DSH 版本未内置该包，或希望显式启用，可在 profile `cordis.patch.yml` 追加：

```yaml
- id: workflow-worker-thread
  disabled: false
  config:
    provider: spawn
```

原生引擎不可用时，插件自动回退「仿真模式」（画布显示徽标），画布交互与结果回填仍可用。

## 架构

- `lib/index.js` — cordis 宿主：`/api/dsh-workflow-studio/{workflow,edge-intent,review-dedupe,review-landing,review-suggest,agents,run,generate}` 端点 + 会话投影 + 原生引擎自挂载。
- `lib/workflow.js` — 纯逻辑（边语义候选、连接章程、Review 去重、拓扑排序）。
- `lib/tree.js` — **自由图数据模型**（唯一启动节点、node kinds、预设/自定义 Agent、reviewLanding、suggestReview、parallelStages、graphDecompose/SCC、summarizeNodeTree）。
- `lib/compile.js` — **画布图 → DSH 原生 workflow 脚本编译器**（Promise.all 并行、反馈环 do-while 负反馈收敛、Loop 循环体嵌套子图、review schema、JSON.stringify 注入安全）。
- `lib/client.js` — React 客户端（`window.__ModuleLoader__`）：双栏对话生成 + 图画布 + 运行时可视化；`@xyflow/react` 与 GSAP 以 UMD 注入。
- `tests/` — `workflow.test.mjs`（58）+ `tree.test.mjs`（40）+ `execute.test.mjs`（11，用 node:vm 真实执行编译脚本）= **109 测试**。
- `cordis.patch.yml` — 注册到 bundle 的补丁。

> `lib/client.js` 为手写校验的 JSX bundle（无独立构建步骤）；`@xyflow/react` 与 GSAP 经 CDN UMD 注入，离线时功能降级。

## 测试

```sh
npm test        # 109 项（纯逻辑 + 图模型 + 真实执行）
npm run check   # 语法检查 + preflight 发布门禁
```

## 贡献

欢迎 Issue / PR。请保持 zh/en 文案对等，并在 `README.md` 追加变更日志。

## 协议

[MIT](LICENSE)

## 变更日志

- 2026 规划：仓库初始化；三份设计文档；host/workflow/client 基座（M0/M1/M2 雏形）。
- 2026 规划：整合 M3 文件气泡、M4 Review 审核+去重+返工边、M5 GSAP 动效；修复函数序列化与 react-dom 注入。
- 2026 规划：新增运行时可视化（红箭头流 + 节点呼吸灯）、节点气泡（常显/悬浮模式 + 任务结果摘要 + 悬浮详情）、整体回退机制（逐节点快照历史 + 依赖级联重置）。
- 2026 规划：新增 `workflow.js` 单元测试并接入 CI；新增插件设置页（气泡显示模式）；Action 三模式选择器；导出/导入。
- 2026 规划：按用户理念重构为**自由图模型 + 对话生成 + 原生并行执行 + 多对多 Review 智能去重 + Loop 循环体容器 + 分支化输出**；新增 `lib/tree.js`、`lib/compile.js`、`lib/execute.test.mjs`；新增 `/run`、`/generate`、`/review-suggest`、`/review-landing`、`/agents` 端点与原生引擎自挂载。
- 2026 规划：安全加固（C1 路径穿越 / readBody 413 / 错误脱敏 / 列表上限）、深色模式与无障碍修复、**109 项测试全绿 + preflight PASS**；创造模式冒泡运行 + node:vm 真实执行验证插件正确可运行。
- 2026-08-20 scoped 身份对齐：`cordis.patch.yml` 的 `name` 与 `lib/client.js` 的 `__ModuleLoader__.load` id 由 `dsh-workflow-studio` 改为规范名 `@eave_bounty/dsh-workflow-studio`（保留旧名别名注册兼容）；CSS tagId/data-plugin 同步；`scripts/preflight.mjs` 校验两个注册。修复 DSH profile 以 scoped 名安装时的 `Cannot find package 'dsh-workflow-studio'` 启动失败。
- 2026 重构：独立 FastAPI 后端 + 根路径 HTML 前端；web/js/app.js 画布核心（菜单/拖拽/候选点选/连线渲染/设置/保存），web/js/edges.js 连线语义与运行可视化模块（接管 window.__wfRun：调 /api/flows/run 后按拓扑顺序逐节点呼吸灯 + 结果气泡 + 出边「流动中虚线动画 → 已流动渐变实线」，平时连线恒为实线）；web/css/edges.css 配套增量样式。
