# flow-forge — REST API 规范

> 人机通用的独立工作流设计引擎（FastAPI 后端 + 根路径 HTML 前端）。DSH 或任何调用方
> （含 Agent）通过本 API 驱动工作流的智能构建。**核心理念：一切模块/连线语义由大模型
> 按流程上下文自动生成，用户/调用方只做审阅裁切，绝不打字。**

- 服务：`python -m uvicorn backend.main:app --host 127.0.0.1 --port 8010`
- 根路径：`http://127.0.0.1:8010/`（渲染 HTML 前端）
- OpenAPI：`http://127.0.0.1:8010/docs`（FastAPI 自动生成）
- **Agent 操作手册**：仓库根 [`AGENTS.md`](../AGENTS.md)（Mode B/Skill——安装、启动、端到端操作协议）

---

## 认证与配置

未配置模型时，所有生成接口自动回退到**内置模板**，保证可运行、不报错。
配置后走真实大模型。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET  | `/api/health` | 健康检查 |
| GET  | `/api/settings` | 读取设置（不泄露 api_key，给 has_key） |
| PUT  | `/api/settings` | 保存设置 `{provider, base_url, model, api_key}` |
| POST | `/api/settings/test` | 测试模型连接，`{ok, reply}` |

---

## 核心生成接口

### 1. 生成模块候选
```
POST /api/module/generate
body: { "kind": "action", "ctx": { "plan": "写季度财报", "upstream": ["调研数据"] } }
resp: { "ok": true, "kind": "action",
        "candidates": [
          {"id":"action-execute","title":"执行任务","description":"...",
           "prompt":"你是执行者：...","recommended":true},
          ...
        ] }
```
`kind` ∈ `root|plan|action|review|loop|summary`。前端把候选展示给用户挑选（标推荐项）。

### 2. 生成连线语义
```
POST /api/edge/semantic
body: { "from_module": {"kind":"action","title":"执行任务"},
        "to_module":   {"kind":"review","title":"审核把关"} }
resp: { "ok": true,
        "intent": "artifact",
        "label": "执行任务 产出交给 审核把关 审核",
        "description": "两模块结合后共同产生的作用...",
        "injection": "如何把上游输出注入下游 Agent 的提示词..." }
```
前端把 label 显示在连线上，点击连线在面板显示 description + injection。

### 3. 运行流程
```
POST /api/flows/run
body: { "nodes":[{"id":"r","kind":"root","title":"起点","prompt":"..."},
                  {"id":"a","kind":"action","title":"执行","prompt":"..."}],
        "edges":[{"source":"r","target":"a","data":{"injection":"注入目标"}}] }
resp: { "ok": true,
        "run_id": "...",
        "results": {"a": {"status":"done","summary":"...","detail":"...","score":0.88}},
        "outputs": {"a": "节点输出文本"} }
```
按拓扑顺序执行，每条边的 `injection` 注入下游上下文。

---

## 画布持久化

| 方法 | 路径 | 说明 |
|------|------|------|
| GET  | `/api/flows` | 列出已保存流程 |
| GET  | `/api/flows/{id}` | 读取流程 |
| POST | `/api/flows` | 保存流程 `{id, name, nodes, edges}` |

---

## 核心理念落地（前端 UI 与外部 Agent 都能驱动"智能构建"）

任意调用方（前端 Web UI，或 DSH/Claude 等 Agent）可这样驱动本服务完成"智能构建"：
1. 调 `POST /api/module/generate` 获得某类模块的候选描述 → 展示给用户/调用方选。
2. 调 `POST /api/edge/semantic` 获得两模块连线的语义 → 标注连线、注入下游。
3. 调 `POST /api/flows/run` 执行 → 回填结果。

前端 UI 把这三步封装为：**拖拽生成（选候选）、连线自动语义（查看作用）、运行可视化（虚线流动 + 结果气泡）**。
