# 模型配置指南

TRPG Workbench 使用三类 AI 模型，各自承担不同职责。你可以在 [模型配置](/settings/models) 页面统一管理。

![模型配置页面](/help-images/model-config.png)

---

## LLM 语言模型

LLM 是驱动所有 Agent 生成内容的核心引擎。

**支持的供应商：**

| 供应商 | 代表模型 | 说明 |
|--------|---------|------|
| Google | Gemini 2.0 Flash | 推荐，长上下文，适合 TRPG |
| OpenAI | GPT-4o | 通用能力强 |
| Anthropic | Claude 系列 | 长文本理解好 |
| OpenRouter | 聚合多家供应商 | 需填写 Base URL |
| OpenAI Compatible | 任何兼容接口，含本地模型 | 需填写 Base URL |

**如何添加：**

1. 进入 [模型配置](/settings/models)，选择「LLM 语言模型」标签页
2. 点击「新增 LLM 配置」

![LLM 配置表单](/help-images/settings-llm.png)

3. 填写配置名称（如"GPT-4o 主力"）、选择供应商、填写模型名称和 API Key
4. 保存配置

> 如果不确定选哪个模型，可以先切换到「模型发现」标签页浏览内置目录，了解各模型的上下文窗口和定价。

---

## 本地模型（离线运行）

本地模型运行在你的电脑上，**无需 API Key，数据不上传到任何服务器**。适合对数据隐私有要求、或希望节省 API 费用的用户。

### 推荐运行软件

| 软件 | 特点 | 下载 |
|------|------|------|
| **LM Studio**（推荐） | 图形界面，内置模型下载，一键启动服务 | [lmstudio.ai](https://lmstudio.ai) |
| **Ollama** | 命令行，轻量，支持 Docker 部署 | [ollama.com](https://ollama.com) |

### 推荐模型（2026 Q2）

> 以下均为 Q4_K_M 量化版本，在创作质量和内存占用之间取得较好平衡。

| 模型 | 最低内存 | 适合场景 | 中文能力 |
|------|---------|---------|---------|
| **Qwen2.5-14B-Instruct** | 10 GB | TRPG 创作主力，综合最佳 | ★★★★★ |
| **Qwen3-30B-A3B**（MoE） | 16 GB | 高质量，激活参数少，推理快 | ★★★★★ |
| Gemma3-12B-it | 10 GB | 英文创作，工具调用稳定 | ★★★☆☆ |
| Gemma3-27B-it | 20 GB | 旗舰本地质量 | ★★★☆☆ |
| Qwen2.5-7B-Instruct | 6 GB | 入门选项，创作质量受限 | ★★★★☆ |

**内存参考：**
- ≥ 20 GB → 可稳定运行 27B 模型
- ≥ 16 GB → 推荐 Qwen3-30B-A3B（MoE 架构，实际激活参数约 3B）
- ≥ 10 GB → 推荐 Qwen2.5-14B（中文 TRPG 场景最性价比）
- ≥ 6 GB &nbsp;&nbsp;→ 可运行 7B，但复杂创作任务可能质量不稳定

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

| 模型 | 运行方式 | Base URL |
|------|---------|---------|
| nomic-embed-text | Ollama：`ollama pull nomic-embed-text` | `http://localhost:11434/v1` |
| nomic-embed-text-v1.5 | LM Studio 内置支持 | `http://localhost:1234/v1` |

Embedding 供应商同样选「OpenAI Compatible」，模型名称填 `nomic-embed-text`。

### 注意事项

- 本地模型服务必须在 TRPG Workbench 使用期间**保持运行**
- `supports_tools`（工具调用）和 `supports_json_mode` 能力因模型而异。多数本地模型不完全支持，建议保持关闭，如有创作异常再调整
- 使用本地模型时，响应速度取决于你的硬件配置；7B/14B 模型在 Apple Silicon Mac 上通常有较好体验

---

## Embedding 向量模型

Embedding 模型将知识库文档转换为向量表示，使得 Agent 在创作时能通过语义检索找到相关规则和设定。

**支持的供应商：** OpenAI、OpenAI Compatible（含本地模型，详见上方）

**推荐配置（云端）：** Jina Embeddings v3（多语言支持，适合中文 TRPG）

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
2. 在「LLM Profile」「Embedding Profile」「Rerank Profile」下拉菜单中选择你配置好的模型
3. 保存

不同工作空间可以绑定不同的模型组合。
