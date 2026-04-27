# 模型配置指南

TRPG Workbench 使用三类 AI 模型，各自承担不同职责。你可以在 [模型配置](/settings/models) 页面统一管理。

![模型配置页面](/help-images/model-config.png)

---

## LLM 语言模型

LLM 是驱动所有 Agent 生成内容的核心引擎。

**支持的供应商：**

| 供应商 | 代表系列 | 说明 |
|--------|---------|------|
| Google | Gemini 系列 | 推荐，长上下文，适合 TRPG |
| OpenAI | GPT 系列 | 通用能力强 |
| Anthropic | Claude 系列 | 长文本理解好 |
| OpenRouter | 聚合多家供应商 | 需填写 Base URL |
| OpenAI Compatible | 任何兼容接口，含本地模型 | 需填写 Base URL |

**如何添加：**

1. 进入 [模型配置](/settings/models)，选择「LLM 语言模型」标签页
2. 点击「新增 LLM 配置」

![LLM 配置表单](/help-images/settings-llm.png)

3. 填写配置名称（如「GPT-4o 主力」）、选择供应商、按需填写 Base URL 与 API Key。LLM Profile 只表示**供应商与凭据**；具体用哪个**模型名**在 [工作空间设置](/help/getting-started) 的「模型路由」里选择（该处提供搜索、按 Tool/JSON 能力筛选，以及目录中的上下文窗口提示）。
4. 保存配置

> 各模型的能力（如是否支持工具调用、JSON 输出）以「模型发现」中的目录为准；请定期在「模型发现」标签页对目标供应商执行「刷新」以同步能力字段。

---

## 本地模型（离线运行）

本地模型运行在你的电脑上，**无需 API Key，数据不上传到任何服务器**。适合对数据隐私有要求、或希望节省 API 费用的用户。

### 推荐运行软件

| 软件 | 特点 | 下载 |
|------|------|------|
| **LM Studio**（推荐） | 图形界面，内置模型下载，一键启动服务 | [lmstudio.ai](https://lmstudio.ai) |
| **Ollama** | 命令行，轻量，支持 Docker 部署 | [ollama.com](https://ollama.com) |

### 推荐模型

根据可用内存选择适合的档位：

| 档位 | 最低内存 | 推荐模型 | 适合场景 |
|------|---------|---------|---------|
| **高端** | ≥ 20 GB | Gemma3-27B、Qwen3-32B、Qwen3-30B-A3B | 最高本地质量 |
| **高质量** | ≥ 12 GB | Qwen3-14B、Gemma3-12B | 创作主力，综合性价比高 |
| **平衡** | ≥ 8 GB | Qwen3-8B | 推荐入门首选 |
| **轻量** | ≥ 4 GB | Qwen3-4B、Gemma3-4B | 设备受限时的可用选项 |

> **兼容备选：** Qwen2.5-7B / Qwen2.5-14B，适合不支持 Qwen3 的旧版运行软件。
>
> 具体量化格式（如 Q4_K_M）由运行软件自动推荐，一般选默认即可。也可在「模型发现」标签页浏览最新目录。

**内存参考：**
- ≥ 20 GB → 可稳定运行高端档
- ≥ 12 GB → 高质量档，中文 TRPG 场景性价比最佳
- ≥ 8 GB &nbsp;→ 平衡档，入门首选
- ≥ 4 GB &nbsp;→ 轻量档，复杂创作任务质量受限

### 配置方法

**使用 LM Studio：**

1. 安装并打开 LM Studio，在「Discover」页面搜索下载所需模型
2. 切换到「Local Server」标签，点击「Start Server」（默认端口 1234）
3. 回到 TRPG Workbench，在配置向导或模型配置页面：
   - 供应商选择：`OpenAI Compatible（含本地模型）`
   - Base URL：`http://localhost:1234/v1`
   - 模型名称：填入 LM Studio 中显示的模型 ID（如 `lmstudio-community/Qwen2.5-14B-Instruct-GGUF`）
   - API Key：填写任意字符（如 `lm-studio`）或留空

**使用 Ollama：**

1. 安装 Ollama，执行 `ollama pull qwen2.5:14b` 下载模型
2. Ollama 默认自动运行服务（端口 11434）
3. 在 TRPG Workbench 中：
   - 供应商选择：`OpenAI Compatible（含本地模型）`
   - Base URL：`http://localhost:11434/v1`
   - 模型名称：`qwen2.5:14b`（与 pull 时名称一致）
   - API Key：填写 `ollama` 或留空

> **提示**：配置向导第一步点击「本地模型选项」可一键填入 LM Studio 或 Ollama 的推荐配置。

### 本地 Embedding 模型

Embedding 模型同样可以本地运行，无需联网。推荐在「模型发现」标签页搜索支持 Embedding 的模型；常见可用选项如 `nomic-embed-text` 系列在 LM Studio 和 Ollama 中均有支持。

Embedding 供应商选「OpenAI Compatible」，Base URL 与 LLM 相同，模型名称填你在运行软件中加载的模型名称。

### 注意事项

- 本地模型服务必须在 TRPG Workbench 使用期间**保持运行**
- 工具调用与「类 JSON 结构化」输出能力因**具体模型**而异。请在「模型发现」目录中确认；在绑定工作区默认 LLM 时，模型选择器会按需要默认筛掉目录中**明确标为不支持**的项，未同步目录的探针结果会标为能力未知
- 使用本地模型时，响应速度取决于你的硬件配置；7B/14B 模型在 Apple Silicon Mac 上通常有较好体验

---

## Embedding 向量模型

Embedding 模型将知识库文档转换为向量表示，使得 Agent 在创作时能通过语义检索找到相关规则和设定。

**支持的供应商：** OpenAI、OpenAI Compatible（含本地模型，详见上方）

**推荐配置（云端）：** Jina Embeddings 系列（多语言支持，适合中文 TRPG）

添加步骤与 LLM 相同。使用 Jina 时，供应商选择「OpenAI Compatible」，Base URL 填写 `https://api.jina.ai/v1`。

---

## 模型发现

「模型发现」标签页展示内置的模型目录，帮助你在配置前了解各模型的规格。

- 支持按供应商过滤
- 可绑定已有 LLM Profile，点击「刷新」动态拉取该供应商的最新模型列表

---

## Rerank 重排序

Rerank 模型对知识库检索结果进行二次排序，提升召回精度。这是**可选功能**——如果你的知识库文档不多，或对检索精度要求不高，可以不配置。

**推荐：** Jina jina-reranker-v2-base-multilingual

---

## 配置完成后

模型添加后，还需要在工作空间中绑定才能生效：

1. 进入工作空间的 [设置](/help/getting-started) 页面
2. 在「模型路由」中为工作区选择**默认 LLM 配置**（LLM Profile），并选择**具体模型名称**；列表会合并「模型发现」目录与从供应商拉取的模型，支持搜索与按能力筛选
3. 按需选择 Embedding、Rerank 等（与 LLM 相互独立）
4. 保存

不同工作空间可以绑定不同的模型组合。
