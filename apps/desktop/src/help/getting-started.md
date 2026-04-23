# 快速入门

欢迎使用 **TRPG Workbench**——一款面向 TRPG 创作者的 AI 辅助工作台。本文带你从安装到开始创作的完整流程。

---

## 首次启动：配置向导

首次打开应用时，你会进入**配置向导**，分四步完成基础设置：

![配置向导](/help-images/setup-wizard.png)

### 第一步：配置 LLM 模型

LLM（大语言模型）是 AI 创作的核心引擎。应用推荐使用 **Google Gemini**，支持长上下文，适合 TRPG 创作场景。

你可以点击「填入 Gemini 推荐值」一键填入推荐配置，只需补充你的 API Key 即可。也可以手动选择其他供应商（OpenAI、Anthropic、OpenRouter 等）。

> 如果暂时没有 API Key，可以点击「稍后配置」跳过，后续在 [模型配置](/settings/models) 页面补充。

### 第二步：配置 Embedding 模型

Embedding 模型用于知识库的语义检索。推荐使用 **Jina Embeddings v3**，支持中文，点击「填入 Jina 推荐值」即可自动填入。

> Embedding 模型是知识库功能的基础。如果你计划导入规则书 PDF，建议在此步配置。

### 第三步：Rerank（可选）

Rerank（重排序）用于提升知识库检索精度，属于可选功能。大多数场景下可以直接点击「跳过此步骤」。

### 第四步：创建工作空间

工作空间是你的创作场所，每个工作空间对应一个独立的游戏世界或模组项目。

填写名称，选择一个规则集（如"通用"），点击「创建并继续」即可。

### 完成

配置向导最后会显示你的配置摘要。点击「开始使用」进入工作台。跳过的配置随时可以在对应页面补充。

---

## 主界面导航

完成配置向导后，每次打开应用会进入首页。首页包含：

![首页](/help-images/home.png)

- **最近工作空间** — 你的所有工作空间卡片，点击「打开」进入工作台
- **顶部导航** — 四个快捷入口：

| 入口 | 用途 | 帮助文档 |
|------|------|---------|
| [规则集](/settings/rule-sets) | 管理规则集，关联知识库和创作风格提示词 | [规则集管理](/help/rule-set-management) |
| [知识库](/knowledge) | 导入规则书 PDF，管理参考资料 | [知识库导入指南](/help/knowledge-import) |
| [模型配置](/settings/models) | 配置 LLM、Embedding、Rerank 模型 | [模型配置指南](/help/model-setup) |
| [用量观测](/usage) | 查看 API 调用记录与费用统计 | — |

---

## 下一步

- **想立刻开始创作？** 打开工作空间，在右侧 Agent 面板输入你的创作需求。详见 [开始创作](/help/start-creating)。
- **想导入规则书？** 前往 [知识库](/knowledge) 上传 PDF。详见 [知识库导入指南](/help/knowledge-import)。
- **想了解模型配置？** 前往 [模型配置](/settings/models)。详见 [模型配置指南](/help/model-setup)。
