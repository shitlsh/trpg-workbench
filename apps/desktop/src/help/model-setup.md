# 模型配置指南

点击顶部导航的 **「模型配置」** 进入模型管理页面。页面包含四个标签页，分别对应不同类型的模型配置。

---

## LLM 语言模型

用于驱动 Agent 生成内容的大语言模型配置。

**支持的供应商：**
- OpenAI（GPT-4o、o1 等）
- Anthropic（Claude 系列）
- Google（Gemini 系列）
- OpenRouter（聚合多家供应商）
- OpenAI Compatible（任何兼容 OpenAI 接口的服务）

**添加步骤：**
1. 点击 **「新增 LLM 配置」**
2. 填写配置名称（例："GPT-4o 主力"）
3. 选择供应商
4. 填写模型名称和 API Key
5. 如使用 OpenAI Compatible，还需填写 Base URL
6. 保存配置

每条配置可独立编辑或删除。

---

## Embedding 向量模型

用于将知识库文档向量化，支持语义检索。

**支持的供应商：** OpenAI、OpenAI Compatible

**添加步骤与 LLM 相同。**

内置目录中包含以下 Embedding 模型可供参考：

| 模型名称 | 供应商 | 向量维度 |
|---------|-------|---------|
| Text Embedding 3 Small | OpenAI | 1536 |
| Text Embedding 3 Large | OpenAI | 3072 |
| Text Embedding Ada 002 | OpenAI | 1536 |
| Jina Embeddings v2 Base EN | Jina | 768 |
| Jina Embeddings v3 | Jina | 1024 |

---

## 模型发现

展示内置模型目录，方便在配置前了解各模型的规格和定价。

**LLM 模型目录（共 15 个）：**

| 供应商 | 代表模型 | 上下文窗口 |
|-------|---------|-----------|
| Anthropic | Claude 3.5 Sonnet | 200K |
| Google | Gemini 2.0 Flash | 1049K |
| OpenAI | GPT-4o | 128K |
| OpenAI | o1 | 200K |
| OpenRouter | DeepSeek Chat V3 | 66K |

页面支持按供应商过滤，也可通过"选择 LLM Profile"绑定已有配置后点击 **「刷新」** 动态拉取该供应商的最新模型列表。

---

## Rerank 重排序

用于对知识库检索结果重新排序，提升召回精度。

**默认推荐：** Jina jina-reranker-v2-base-multilingual

**添加步骤与 LLM 相同。**

Rerank 模型与知识库检索联动——在工作空间模型路由中启用后，知识库检索会先召回候选片段，再经 Rerank 模型精排，提升最终结果质量。

---

## 配置后的下一步

所有模型配置完成后，在工作空间的 **「设置」** 页面为该工作空间绑定对应的 LLM Profile、Embedding Profile 和 Rerank Profile，完成模型路由配置。
