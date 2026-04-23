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
| OpenAI Compatible | 任何兼容接口 | 需填写 Base URL |

**如何添加：**

1. 进入 [模型配置](/settings/models)，选择「LLM 语言模型」标签页
2. 点击「新增 LLM 配置」

![LLM 配置表单](/help-images/settings-llm.png)

3. 填写配置名称（如"GPT-4o 主力"）、选择供应商、填写模型名称和 API Key
4. 保存配置

> 如果不确定选哪个模型，可以先切换到「模型发现」标签页浏览内置目录，了解各模型的上下文窗口和定价。

---

## Embedding 向量模型

Embedding 模型将知识库文档转换为向量表示，使得 Agent 在创作时能通过语义检索找到相关规则和设定。

**支持的供应商：** OpenAI、OpenAI Compatible

**推荐配置：** Jina Embeddings v3（多语言支持，适合中文 TRPG）

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
