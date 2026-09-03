# flow-forge

> **人机通用的智能工作流设计引擎**（FastAPI 后端 + 根路径 HTML 前端）。任何入口——人用 Web 画布、Agent 走 REST API——都通过同一套语义引擎，让大模型按流程上下文**起草**结构，人只做**审阅裁切**，绝不打字。

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![python](https://img.shields.io/badge/python-%3E%3D3.10-blue)](#要求)

## 定位与核心理念

flow-forge 是一个**独立可运行**的工作流编排工具：**后端服务 + 浏览器前端**，DSH 或任何调用方通过其 REST API 驱动智能构建。早期它曾是 DSH 插件，现已彻底重构并更名，与 DSH 解绑，成为通用服务。

**核心理念（必须遵守）**：
- **用户绝不打字**：画布上拖入的每个模块、连上的每条线，都由大模型根据流程上下文**自动生成候选描述**，用户只从多个候选中**挑一个**（标出推荐项）。
- **连线自动语义**：连线自动生成「这条线的作用 + 两模块结合的作用 + 如何注入下一个模块的 Agent」，用户查看/确认。
- **虚线只在运行后出现**：平时用实线表示结构关系；运行后才用虚线+流动动画表示数据在传输。
- **运行必须真实可执行**：未配置模型时自动回退内置模板，绝不报错。
- **起点必填 goal**：唯一起点（root）必须先填项目总目标，在填满前禁止拖入其它任何模块；起点不出现在左侧菜单，也无法拖出第二个。
- **一键起草（L1）**：填好 goal 后点「起草」，大模型按流程上下文**起草整张图**（拓扑 + 每模块描述 + 每条连线语义），用户在审阅弹层里逐项勾选保留——**结构由 AI 起草、人做审阅裁切**，最大化增幅。
- **会话说即改（L2）**：底部指令条输入一句修改意图（如"在动作后加一步审核把关"），大模型把意图翻译成**图谱修订**，弹层预览 + 可撤销，确认后应用——改动降至一句话，仍保持全图可视可控。
- **运行后自省（L3）**：跑完自动把**结果 vs 目标**对比，在底部弹出建议条指出薄弱点（低分审核 / 缺把关的动作 / 缺汇总），点「应用建议」直接把改进意图送进 L2 预览——形成「起草→执行→自省→改进→重跑」自我改进闭环。

## 双模式（一个引擎，两个消费入口）

flow-forge 的引擎与产物格式（flow 文件 + REST API）**完全共享**，只是"谁在驱动"不同：

- **模式 A · 纯项目**：人用。`python -m uvicorn backend.main:app` 起服务，浏览器打开画布肉眼编排。配置即 JSON（见下）。
- **模式 B · Skill**：Agent 用。服务内置一套"怎么装、怎么启动、怎么操作"的操作协议，Agent（DSH/Claude 等）拿到即可自动搭建并跑完一个工作流。

> 当前版本先把**模式 A 与配置层**落地，模式 B 的 Skill 操作协议正在建设中。

## 快速开始

```bash
# 安装依赖
pip install -r requirements.txt

# 启动（根路径渲染 HTML 前端）
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8010
```

打开 `http://127.0.0.1:8010/` 即可使用画布。右上角「设置」填入模型厂商 / 模型 / API Key 后走真实大模型；不填则用内置模板（仍可完整使用）。

### 配置

模型设置默认写于本机 `data/settings.json`（已 gitignore，key 永不提交），也可用环境变量注入：

```
FLOW_FORGE_PROVIDER / FLOW_FORGE_BASE_URL / FLOW_FORGE_MODEL / FLOW_FORGE_API_KEY
```

> 阶段二将升级为**集中 JSON 工程配置**（可提交、可版本化），使 Web 设置页写入与直接编辑 JSON 等价。

## 目录

- `backend/` — FastAPI 后端（`main.py` 入口；`llm.py` 生成逻辑；`settings.py` 设置存储；`routers/`）
- `web/` — 前端（`index.html` + `css/` + `js/app.js` 画布核心 + `js/edges.js` 连线/运行）
- `docs/` — 文档与实现报告（API 规范、前端模块报告）
- `scripts/` — 冒烟与真实浏览器端到端测试
- `data/` — 本地设置与流程存储（已 gitignore）

## REST API（摘要）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET  | `/` | 渲染前端 |
| GET/PUT | `/api/settings` | 读取/保存模型设置 |
| POST | `/api/settings/test` | 测试模型连接 |
| POST | `/api/module/generate` | 生成模块候选 `{kind, ctx}` → `{candidates:[...]}` |
| POST | `/api/edge/semantic` | 生成连线语义 `{from_module, to_module}` → `{label, description, injection}` |
| POST | `/api/flows/draft` | (L1) 从 goal 起草整张图 `{goal}` → `{nodes, edges}` |
| POST | `/api/flows/tweak` | (L2) 会话说即改：意图→修订图 `{intent, nodes, edges}` → `{nodes, summary}` |
| POST | `/api/flows/run` | 运行流程 `{nodes, edges}` → `{results, outputs}` |
| GET/POST | `/api/flows` | 保存/加载画布 |

详见 [`docs/API.md`](docs/API.md)。

## 要求

- Python ≥ 3.10
- 可选：真实浏览器测试需 Chrome（见 `scripts/browser-e2e.py`）

## 贡献

欢迎 Issue / PR。请保持 zh/en 文案对等，并在 `README.md` 追加变更日志。

## 协议

[MIT](LICENSE)

## 变更日志

- 2026 规划：仓库初始化；早期为 DeepSeek Harness 插件（`lib/`、`cordis.patch.yml`），含 Plan→Action→Review 自由图画布、Review 去重、原生并行执行等。后按用户理念反复重构。
- 2026-08 大重构（v0.4.0 起）：彻底改为**独立前端项目**（FastAPI 后端 + 根路径 HTML 前端），删除 DSH 插件架构。web/js/app.js 画布核心（菜单/拖拽/候选点选/连线渲染/设置/保存），web/js/edges.js 连线语义与运行可视化（虚线只在运行时出现）。
- 2026 起点强制（goal-gate）：唯一起点必须先填 goal，填目标前禁止拖入其它模块。
- 2026 更名 flow-forge：仓库从 dsh 身份彻底解绑，删除旧 DSH 插件源码（lib/、tests/、cordis.patch.yml、package.json）与旧版设计/审计文档；CI 改为 Python。
- 2026 双模式 + 配置层：集中 JSON 工程配置（`flowforge.config.json`，可提交、无密钥；api_key 只落 gitignored `data/settings.json`，Web 设置页与编辑 JSON 等价）；新增 AGENTS.md（Mode B/Skill：Agent 安装/启动/端到端操作协议）。
- 2026 L1 一键起草：`POST /api/flows/draft` + 前端「起草」按钮与审阅裁剪弹层——填好 goal 后由模型起草整张图，用户逐项勾选保留并应用。
- 2026 L2 会话说即改：`POST /api/flows/tweak` + 底部「说即改」指令条——一句意图→图谱修订→可撤销预览→应用；离线启发式（插审核/删模块）绝不报错。
- 2026 L3 运行后自省：`POST /api/flows/selfreview` + 跑完自动弹出建议条（薄弱点 + 可执行 suggestion_intent）→「应用建议」一键送进 L2 预览，形成起草→执行→自省→改进→重跑闭环；离线启发式自省。修改 AGENTS.md/API.md/README 同步三阶段能力。
