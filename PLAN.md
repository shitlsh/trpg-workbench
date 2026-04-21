# trpg-workbench 完整方案 v1

## 1. 产品定位

`trpg-workbench` 是一个 **本地优先（local-first）的 TRPG / 跑团主持人辅助工作台**。

它不是单纯聊天工具，而是一个围绕 **规则资料、知识库、工作空间、结构化创作资产、Agent 协作编辑** 设计的桌面应用。
目标用户主要是：

* 跑团主持人 / Keeper / DM / GM
* 模组编写者
* 世界观与剧情设计者
* 想用 AI 辅助构建模组、场景、NPC、怪物、地图说明的人

它的核心不是“一次性生成整篇剧本”，而是：

* 在某个规则体系下建立工程
* 导入资料形成知识库
* 用对话方式逐步生成和修改资产
* 将结果落为结构化文档
* 保留引用、上下文、一致性与可持续迭代能力

---

## 2. 产品目标

### 2.1 核心目标

做一个像 IDE 一样的本地桌面工具，用于：

* 创建某规则下的创作工作空间
* 导入规则书 PDF 构建知识库
* 用 Agent 对话生成模组/剧本
* 生成结构化资产：大纲、场景、NPC、怪物、地点、线索、分支、时间线
* 通过对话持续修改已有内容
* 在生成时参考本地知识库
* 支持用户自行配置模型供应商与中转站
* 未来保留云同步/协作扩展空间，但第一版不依赖云

### 2.2 非目标

第一版不追求：

* 完整多人协作
* 在线 SaaS
* 复杂地图编辑器
* 严格的全自动规则引擎
* 一键自动跑团
* 完整玩家端/主持人端双端系统

---

## 3. 产品原则

### 3.1 Local-first

第一版优先单机、本地可运行、本地存储。
后续可扩展云同步，但本地工作流不能依赖云。

### 3.2 通用规则框架

产品不绑定某个具体规则体系。
首批测试与 prompt/模板优化可优先偏向 **COC**，但系统设计必须能承载：

* COC
* DND
* PF
* 其他自定义规则

### 3.3 用户自导入资料

不预置有版权风险的规则书内容。
知识库由用户本地导入 PDF，自行构建。这样在合规上更稳。

### 3.4 结构化优先

第一版以 **结构化文档树** 为主，而不是“长篇富文本成品”。
生成结果既要能让程序读，也要能让人看。

### 3.5 AI 是“共创编辑器”，不是“黑盒生成器”

AI 输出必须可追踪、可修改、可局部重写、可查看引用与变更。

---

## 4. 目标用户场景

### 场景 A：创建新模组

用户创建一个 COC 工作空间，导入基础规则和参考模组 PDF。
然后通过对话：

* 生成故事大纲
* 生成场景结构
* 生成关键 NPC
* 生成若干线索链
* 生成怪物/异常实体设定
* 生成地点说明与地图描述

### 场景 B：修订既有剧本

用户说：

* “把第一幕改得更压抑一点”
* “增加两个误导性线索”
* “这个 NPC 的动机太弱，补强”
* “把最终反转提前埋伏笔”
* “怪物不要直接杀伤，改成认知污染型”

系统只修改相关资产，并给出变更说明。

### 场景 C：规则辅助

用户选中某个怪物或场景，要求：

* “按当前规则审视是否太强”
* “这个检定设计合理吗”
* “这个遭遇对 4 个新手玩家是否过重”

系统结合知识库和规则提示给出建议，而不是单纯自由发挥。

### 场景 D：可选图像拓展

用户完成 NPC / 怪物 / 地点说明后，可手动点击：

* “生成 NPC 立绘”
* “生成怪物概念图”
* “生成地点地图图像”

默认先输出结构化说明文档，再由外部生图 API 按说明生成图像。

---

## 5. 功能范围

## 5.1 第一版核心功能

### 5.1.1 规则体系管理

* 创建规则体系（Rule Set）
* 规则体系只定义“工程上下文”
* 不强绑定任何预置版权内容
* 可添加规则描述、风格说明、推荐 system prompt 模板

### 5.1.2 PDF 导入与知识库构建

* 上传 PDF
* 解析文本
* 切分 chunk
* 建立向量索引
* 给 PDF 打标签，如：

    * 基础规则
    * 扩展规则
    * 参考模组
    * 怪物手册
    * 世界观资料
    * 房规补充

### 5.1.3 工作空间（Workspace）

* 在某个 Rule Set 下创建 Workspace
* Workspace 可绑定多个知识库
* Workspace 保存：

    * 模型配置
    * prompt 配置
    * 资产树
    * 对话历史
    * 生成设置

### 5.1.4 结构化资产管理

资产类型建议至少包括：

* 故事大纲
* 场景 / Stage
* NPC
* 怪物 / 实体
* 地点 / Location
* 线索 / Clue
* 分支 / Branch
* 时间线 / Timeline
* 设定词条 / Lore Note
* 地图说明 / Map Brief

### 5.1.5 Agent 对话创作

用户通过聊天驱动创作，支持：

* 新建资产
* 基于现有资产扩写
* 局部重写
* 风格调整
* 一致性检查
* 规则参考问答

### 5.1.6 变更落盘

每次生成不是只显示聊天文本，而是能够：

* 创建新文档
* 修改已有文档
* 写入 JSON / Markdown 资产
* 展示变更摘要

### 5.1.7 引用与来源

* 展示 AI 参考了哪些知识库文档
* 至少展示 PDF 名称、章节/页码（可取到时）、相关片段

### 5.1.8 模型供应商配置

支持用户自定义：

* OpenAI
* Anthropic
* Google
* OpenRouter
* 兼容 OpenAI API 的服务
* 中转站 / 自定义 Base URL

### 5.1.9 图像生成拓展

非默认主流程，作为扩展能力：

* 基于 NPC / 怪物 / 地点 / 地图说明文档
* 一键生成图像 prompt
* 调用外部图像 API
* 将结果保存到工作空间资源目录

---

## 5.2 第二阶段功能

* 云同步
* 多设备同步
* 团队协作
* Git-like 历史版本
* 复杂关系图谱
* 可视化分支图
* 更严格的数值平衡校验
* 模板市场 / Prompt 预设
* 规则适配器系统
* 插件系统

---

## 6. 技术选型结论

## 6.1 前端与桌面壳

### 选择

* **Tauri**
* **React**
* **Vite**
* TypeScript

### 原因

Tauri 官方明确支持多种前端框架，并提供 React 模板；同时 Tauri 是 frontend-agnostic，可与 Vite 结合。React 官方定位是 UI 库，而 Next.js 官方定位是面向全栈 Web 的 React 框架。对本地桌面 IDE 工具来说，`Tauri + React + Vite` 比 `Tauri + Next.js` 更贴合。([Tauri][2])

### 不选 Next.js 的理由

* 你的产品不是以 Web/SSR/SEO 为核心
* 不是典型全栈 Web App
* Tauri 桌面端更需要轻量客户端架构
* Next.js 的 App Router、Server Components、Route Handlers 对第一版不是刚需

---

## 6.2 AI 编排层

### 选择

* **Python**
* **Agno**

### 原因

Agno 官方文档覆盖 Agent、Teams、Workflows、Knowledge、Memory，适合作为你的 AI 编排内核，而不是整套 UI 平台。你这个项目正需要：

* 多 Agent
* 知识库检索
* 工作流编排
* 会话状态
* 长期记忆
* 可切换模型供应商

这些都与 Agno 能力匹配。([Agno][1])

---

## 6.3 存储与索引

### 第一版建议

* **SQLite**：主业务数据库
* **本地文件系统**：资产文档、PDF、图像
* **向量索引**：本地文件型向量库（推荐 lancedb 或 hnswlib），不依赖外部服务

### 原因

* 本地优先，零部署，对非技术用户友好
* SQLite 内置于 Python，无需额外安装，Tauri 打包无额外负担
* 单用户桌面工具无并发写入需求，SQLite WAL 模式完全够用
* SQLite 支持 JSON1（JSON 字段查询）和 FTS5（全文检索）扩展
* 适合 MVP 和早期试用

### 未来升级路径（供参考，第一版不做）

**本地 PostgreSQL 不适合桌面端**：需要用户单独安装数据库服务，打包体积大，进程管理复杂，对目标用户体验差。

未来升级方向建议：

* **本地 → 多设备同步**：升级到 **libSQL / Turso**（SQLite 的分布式扩展，API 与 SQLite 完全兼容，无需重写代码）
* **向量库**：lancedb 本地版 → lancedb 云版本，可平滑升级
* **云同步 / SaaS 阶段**：此时可引入 PostgreSQL + pgvector，作为服务端存储层

---

## 6.4 编辑器与 UI 组件

### 选择

* **Monaco Editor**：结构化文档/JSON/Markdown 编辑
* 富文本暂缓，第一版不做重型富文本主编辑器
* 状态管理可用：

    * Zustand 或 TanStack Store 风格方案
* 数据请求：

    * TanStack Query
* UI 组件：

    * shadcn/ui 或类似轻量组件体系

---

## 7. 总体架构

## 7.1 分层

### A. 桌面应用层

Tauri

* 应用窗口
* 本地菜单
* 系统文件对话框
* 安装包
* 桌面生命周期

### B. 前端 UI 层

React + Vite

* 项目树
* 编辑区
* Agent 面板
* 资产详情面板
* 知识库管理界面
* 模型配置界面
* 引用与日志显示

### C. 应用服务层

本地后端服务（建议 Python）

* 工作空间管理
* 文件导入
* PDF 解析
* 资产读写
* patch 应用
* 任务调度
* 图像生成调用
* 配置与日志

### D. AI 编排层

Agno

* Director Agent
* Rules Agent
* Plot Agent
* NPC Agent
* Monster Agent
* Consistency Agent
* Workflow 编排
* Knowledge 检索
* 会话与记忆

### E. 数据层

* SQLite
* 本地资产目录
* 向量索引目录
* PDF 原始文件目录
* 图像资源目录

---

## 7.2 推荐运行模式

### 推荐方案：双进程本地架构

* 前端：Tauri + React
* 后端：本地 Python 服务

通信方式任选其一：

#### 方案 1：本地 HTTP API

* 前端调用 `http://127.0.0.1:<port>`
* 实现简单
* 调试方便

#### 方案 2：Tauri command + sidecar

* Tauri 启动 Python sidecar
* 更桌面化
* 进程管理更集中

### 建议

第一版优先：
**Tauri + React 前端 + Python 本地 API 服务**

原因：

* 开发调试更简单
* Python 生态处理 PDF / AI / 数据更顺
* 后续再决定是否收敛成更深的 sidecar 模式

---

## 8. 核心业务模型

## 8.1 RuleSet

代表一个规则体系模板。

字段建议：

* `id`
* `name`
* `slug`
* `description`
* `genre`
* `default_prompt_profile`
* `default_asset_schema`
* `created_at`
* `updated_at`

说明：

* 可以是通用空规则
* 也可以是 “COC-style” 的默认模板
* 不内置版权资料，只内置 schema 和 prompt

---

## 8.2 KnowledgeLibrary

代表一组知识库集合。

字段：

* `id`
* `rule_set_id`
* `name`
* `type`

    * `core_rules`
    * `expansion`
    * `module_reference`
    * `monster_manual`
    * `lore`
    * `house_rules`
* `description`
* `embedding_config`
* `created_at`

---

## 8.3 KnowledgeDocument

字段：

* `id`
* `library_id`
* `filename`
* `original_path`
* `mime_type`
* `parse_status`
* `page_count`
* `metadata_json`
* `created_at`

---

## 8.4 KnowledgeChunk

字段：

* `id`
* `document_id`
* `chunk_index`
* `content`
* `embedding_ref`
* `page_from`
* `page_to`
* `section_title`
* `metadata_json`

---

## 8.5 Workspace

字段：

* `id`
* `rule_set_id`
* `name`
* `description`
* `model_profile_id`
* `prompt_profile_id`
* `workspace_path`
* `created_at`
* `updated_at`

说明：
一个工作空间只能归属一个规则体系，但可挂多个知识库。

---

## 8.6 WorkspaceLibraryBinding

字段：

* `workspace_id`
* `library_id`
* `priority`
* `enabled`
* `scope_rules_json`

用于实现：

* 当前工作空间启用哪些资料
* 哪些优先级更高
* 哪些资产类型使用哪些库

---

## 8.7 Asset

字段：

* `id`
* `workspace_id`
* `type`
* `name`
* `slug`
* `path`
* `status`
* `summary`
* `metadata_json`
* `created_at`
* `updated_at`

`type` 示例：

* `outline`
* `stage`
* `npc`
* `monster`
* `location`
* `clue`
* `branch`
* `timeline`
* `map_brief`
* `lore_note`

---

## 8.8 AssetRevision

字段：

* `id`
* `asset_id`
* `version`
* `content_md`
* `content_json`
* `change_summary`
* `source_type`
* `created_at`

说明：

* `content_json` 供程序使用
* `content_md` 供用户阅读
* 变更要可回溯

---

## 8.9 ChatSession

字段：

* `id`
* `workspace_id`
* `agent_scope`
* `title`
* `created_at`
* `updated_at`

---

## 8.10 ChatMessage

字段：

* `id`
* `session_id`
* `role`
* `content`
* `references_json`
* `tool_calls_json`
* `created_at`

---

## 8.11 ModelProfile

字段：

* `id`
* `name`
* `provider_type`
* `base_url`
* `api_key_ref`
* `model_name`
* `temperature`
* `max_tokens`
* `capabilities_json`

支持：

* OpenAI
* Anthropic
* Google
* OpenRouter
* OpenAI-compatible
* 自定义中转

---

## 8.12 ImageGenerationJob

字段：

* `id`
* `workspace_id`
* `asset_id`
* `prompt`
* `provider`
* `status`
* `result_path`
* `created_at`

---

## 9. 本地文件目录建议

```text
trpg-workbench-data/
  app.db
  workspaces/
    <workspace-id>/
      assets/
        outline/
        stages/
        npcs/
        monsters/
        locations/
        clues/
        branches/
        timelines/
        map_briefs/
      revisions/
      exports/
      images/
      logs/
  knowledge/
    libraries/
      <library-id>/
        source/
          xxx.pdf
        parsed/
          manifest.json
          chunks.jsonl
        index/
  settings/
    model_profiles.json
    prompt_profiles.json
```

---

## 10. 资产格式建议

你已经选择 **JSON + Markdown 混合**，这是合理的。

## 10.1 原则

* Markdown 用于人读
* JSON 用于程序编辑、依赖分析、自动 patch、生成图像 prompt

## 10.2 示例：NPC

### `npcs/mayor-arthur.md`

```md
# Arthur Hale

## 概述
镇长，表面亲和，实则掩盖十五年前的失踪案。

## 外在形象
……

## 动机
……

## 秘密
……

## 与玩家的互动建议
……
```

### `npcs/mayor-arthur.json`

```json
{
  "id": "npc_mayor_arthur",
  "name": "Arthur Hale",
  "role": "镇长",
  "public_persona": "温和可靠",
  "hidden_truth": "掩盖旧案",
  "motivation": ["维持秩序", "保护自己的名誉"],
  "relationships": [
    {"target": "npc_doctor_elsa", "type": "alliance"}
  ],
  "appearance_brief": "中年，衣着体面，神色疲惫",
  "dialogue_style": "克制、官方、绕弯子"
}
```

---

## 11. Agent 体系设计

## 11.1 Director Agent

角色：总控调度

负责：

* 理解用户意图
* 判断是“新建资产”还是“修改资产”
* 选择要调用的子 Agent
* 组织最终输出
* 生成变更计划

典型输入：

* “帮我做一个 COC 乡村调查模组”
* “把第一幕改得更阴森”
* “新增一个关键证人 NPC”

---

## 11.2 Rules Agent

角色：规则顾问

负责：

* 回答规则问题
* 依据知识库引用规则资料
* 对怪物、检定、遭遇进行建议性审查

第一版定位：

* **建议型**
* 不承诺绝对规则引擎级正确性

---

## 11.3 Plot Agent

角色：剧情与模组结构设计

负责：

* 故事主线
* 场景结构
* 分支设计
* 线索链
* 节奏控制

---

## 11.4 NPC Agent

负责：

* 角色设定
* 动机
* 关系网
* 台词风格
* 秘密信息

---

## 11.5 Monster / Entity Agent

负责：

* 怪物或异常实体概念
* 行为模式
* 威胁表现
* 与规则的适配建议

---

## 11.6 Lore Agent

负责：

* 地点设定
* 历史背景
* 势力关系
* 世界观补充

---

## 11.7 Consistency Agent

负责：

* 命名一致性
* 时间线冲突
* 动机冲突
* 线索断裂
* 分支矛盾

---

## 11.8 Document Agent

负责：

* 将结果格式化为资产文档
* 生成 JSON + Markdown
* 输出改动摘要与 patch 提案

---

## 12. Workflow 设计

Agno 提供 Agents、Teams、Workflows；你的项目建议把“创作过程”拆成 workflow，而不是单次自由聊天。([Agno][1])

## 12.1 新建模组 Workflow

步骤建议：

1. 读取当前 Workspace 配置
2. 检索相关知识库
3. 生成故事 premise
4. 生成大纲
5. 生成 stage 列表
6. 生成 NPC / 地点 / 线索初稿
7. 一致性检查
8. 写入资产
9. 生成变更摘要

---

## 12.2 修改资产 Workflow

步骤：

1. 识别用户改动意图
2. 找到受影响资产
3. 检索相关规则/上下文
4. 调用对应子 Agent 重写
5. 跑一致性检查
6. 生成 patch
7. 写入 revision
8. 返回 diff 摘要

---

## 12.3 规则咨询 Workflow

步骤：

1. 读取选中资产
2. 检索知识库
3. 汇总引用
4. 输出建议与风险点
5. 不自动落盘，除非用户确认“应用建议”

---

## 12.4 图像拓展 Workflow

步骤：

1. 读取资产说明 JSON/MD
2. 生成图像提示词
3. 用户确认或编辑
4. 调用图像 API
5. 存储结果图像
6. 关联到资产

---

## 13. 知识库设计

## 13.1 知识库层次

建议采用三层：

### 层 1：Rule Set 层

定义框架，不含版权内容。

### 层 2：Library 层

按用途分库：

* 基础规则
* 参考模组
* 怪物手册
* 世界观资料
* 房规补丁

### 层 3：Document 层

具体 PDF 文件。

---

## 13.2 检索策略

不要做“所有内容一个大库无差别检索”。

建议支持：

* 指定库优先级
* 按资产类型选择库
* 按文档标签过滤
* 引用结果附带来源信息

示例：

* 生成怪物时优先：怪物手册 > 基础规则 > 参考模组
* 生成剧情时优先：参考模组 > 世界观资料 > 基础规则
* 做规则审查时优先：基础规则 > 房规补丁

---

## 13.3 PDF 处理策略

第一版只做 PDF，建议流程：

1. 原始 PDF 保存
2. 提取文本
3. 基础清洗
4. 按段落/标题切块
5. 记录页码映射
6. 生成 embedding
7. 入索引
8. 生成 manifest

### 注意

PDF 解析是整个项目的关键质量点。
不是所有 PDF 都能高质量解析，尤其表格、双栏、扫描件会比较麻烦。
因此第一版要明确：

* 优先支持文本型 PDF
* 扫描版 PDF 只做弱支持或暂不承诺效果

---

## 14. Prompt 与规则适配策略

## 14.1 通用 prompt 框架

每个 Rule Set 有一个默认 prompt profile：

包含：

* 写作风格
* 规则约束方式
* 输出资产 schema
* 安全边界
* 引用要求
* 修改原则

## 14.2 COC 风格预设

可做内置模板，但不打包规则书内容：

包括：

* 氛围偏向
* 线索组织方式
* NPC 写法
* 调查场景节奏
* 怪异事件表现方式

这样既支持通用框架，也能方便你当前先测试 COC 风格。

---

## 15. 图像生成能力设计

你提出“不做复杂地图编辑器，但可基于说明文档生成图片”，这是合理的折中。

## 15.1 第一版定位

图像能力是 **拓展功能**，不干扰主创作流。

### 支持对象

* NPC 立绘
* 怪物概念图
* 地点场景图
* 地图概念图

### 工作方式

* Agent 先生成 `image_brief`
* 用户点击“生成图像”
* 调用外部 API
* 保存结果

---

## 15.2 示例资产扩展字段

```json
{
  "image_brief": {
    "subject": "破败维多利亚时代乡村宅邸",
    "mood": "潮湿、阴冷、压抑",
    "key_elements": ["长廊", "煤油灯", "发霉墙纸"],
    "camera": "俯视斜角",
    "style": "写实概念图"
  }
}
```

---

## 16. 前端界面设计

## 16.1 主界面布局

建议三栏式：

### 左栏：项目树

* Workspace
* 知识库
* 资产树
* 搜索

### 中栏：主编辑区

* Markdown/JSON 编辑
* 资产详情
* Diff 视图
* 引用预览

### 右栏：Agent 面板

* 对话区
* 快捷动作
* 执行日志
* 建议与 patch 摘要

---

## 16.2 页面/模块列表

### 首页

* 最近工作空间
* 新建工作空间
* 导入 PDF
* 模型配置入口

### 工作空间设置

* 规则体系
* 绑定知识库
* 默认模型
* Prompt 配置

### 知识库管理

* PDF 导入
* 解析状态
* 文档标签
* 重建索引

### 资产浏览器

* 资产树
* 新建资产
* 搜索/过滤

### 编辑器

* Markdown / JSON 双视图
* revision 历史
* diff

### Agent 控制台

* 聊天
* 执行计划
* 引用
* 应用建议

---

## 17. 交互设计要点

## 17.1 不直接覆盖全文

用户一句“改一下第一幕”时，系统应：

* 先识别影响范围
* 只改相关资产
* 给出改动摘要

## 17.2 聊天输出要分层

AI 响应建议分为：

* 解释
* 将要修改的资产
* 变更摘要
* 引用来源
* 是否已落盘

## 17.3 引用可见

尽量显示：

* 文档名
* 页码
* 短片段

## 17.4 失败可恢复

若解析失败或模型调用失败：

* 保留上下文
* 不破坏已有资产
* 显示重试入口

---

## 18. 模型接入设计

## 18.1 Provider 抽象

统一配置项：

* provider type
* api key
* base url
* model name
* temperature
* max tokens
* capabilities

## 18.2 支持范围

* OpenAI
* Anthropic
* Google
* OpenRouter
* OpenAI-compatible
* 自定义 base URL / 中转站

## 18.3 建议策略

不同任务可绑定不同模型：

* Director / Plot：高质量模型
* Rules：稳定、低幻觉模型
* 批量 NPC：更便宜模型
* 图像 Prompt：快速模型

---

## 19. Revision / Diff 设计

## 19.1 Revision 策略

每次落盘都生成一条 revision。

保存：

* 原始内容
* 新内容
* 变更摘要
* 触发来源（用户手改 / Agent 改）

## 19.2 Diff 展示

第一版可只做：

* 文本 diff
* JSON 字段变化摘要

例如：

* 修改了 1 个 Stage
* 新增 2 个 NPC
* 更新了 1 个怪物的动机与能力描述

---

## 20. 日志与可观测性

第一版建议记录：

* 模型调用日志
* PDF 解析日志
* 工作流执行步骤
* 检索命中结果
* 资产写入记录

这样在调试 prompt 和 RAG 时会非常重要。

---

## 21. 安全与合规

## 21.1 版权

* 不预置规则书 PDF
* 用户自行本地导入
* 本地构建知识库
* 默认不上传原文到第三方，除非用户主动调用云模型

## 21.2 密钥管理

* API Key 本地加密存储
* 不写入导出文档
* 日志脱敏

## 21.3 隐私提醒

当用户使用云模型时，应提示：

* 内容会发送给所选 provider
* 本地模式与云模式差异

---

## 22. MVP 范围

## 22.1 MVP 必做

1. 桌面应用外壳
2. 本地工作空间创建
3. PDF 导入与基础知识库
4. 结构化资产树
5. Agent 对话生成
6. 资产落盘
7. 模型配置
8. Revision 基础功能
9. 引用显示
10. 图像生成接口预留

## 22.2 MVP 不做

1. 多人协作
2. 云同步
3. 复杂地图编辑器
4. 严格数值战斗模拟
5. 插件市场
6. 富文本大型编辑系统

---

## 23. 里程碑建议

## 里程碑 1：基础骨架

* Tauri + React + Vite 项目初始化
* Python 后端骨架
* SQLite 初始化
* Workspace 基础 CRUD
* 模型配置页

## 里程碑 2：知识库 MVP

* PDF 导入
* 解析与切块
* 向量索引
* 简单检索测试
* 引用显示

## 里程碑 3：资产系统

* 资产树
* JSON + Markdown 存储
* Asset Revision
* 编辑器与保存

## 里程碑 4：Agent 创作

* Director Agent
* Plot / NPC / Rules 基础 Agent
* 新建模组 workflow
* 修改资产 workflow

## 里程碑 5：产品打磨

* diff
* 日志
* 执行状态提示
* 图像生成拓展
* Prompt 配置页

---

## 24. 推荐仓库结构

```text
trpg-workbench/
  apps/
    desktop/
      src/                # React + Tauri frontend
      src-tauri/
    backend/
      app/
        api/
        services/
        agents/
        workflows/
        knowledge/
        storage/
        models/
        utils/
      tests/
  packages/
    shared-schema/
      src/
    prompt-templates/
    asset-templates/
  docs/
    product/
    architecture/
    prompts/
  scripts/
```

---

## 25. 后端模块建议

## 25.1 `api/`

* workspace API
* knowledge API
* asset API
* chat API
* image API
* settings API

## 25.2 `services/`

* workspace service
* asset service
* revision service
* model service
* image service

## 25.3 `agents/`

* director.py
* rules.py
* plot.py
* npc.py
* monster.py
* lore.py
* consistency.py
* document.py

## 25.4 `workflows/`

* create_module.py
* modify_asset.py
* rules_review.py
* generate_image.py

## 25.5 `knowledge/`

* pdf_ingest.py
* chunker.py
* embedder.py
* retriever.py
* citations.py

---

## 26. 推荐的第一版生成策略

因为你对“规则校验强度”暂时不想定死，第一版建议这样处理：

### 生成层

* Plot / NPC / Monster 等负责创作

### 校验层

* Rules Agent 给出“建议性校验”
* Consistency Agent 给出“结构一致性检查”

### 不承诺

* 不承诺严格规则引擎级自动审判
* 不承诺所有数值都完全符合规则原文
* 对扫描差、解析差 PDF 不承诺高精度引用

这条路线风险更低，也更适合 MVP。

---

## 27. 为什么这个方案适合你当前阶段

### 27.1 符合你的真实目标

你不是做一个纯聊天机器人，而是做一个 **创作工作台**。

### 27.2 保留未来扩展性

* 本地优先
* 后续可做同步
* 通用规则框架
* 可插拔 provider
* 可加图像能力

### 27.3 控制复杂度

* 不上复杂地图编辑器
* 不做过重富文本
* 不做严格规则引擎
* 先把最值钱的链路打通

### 27.4 与技术选型匹配

Agno 的 Agent/Teams/Workflows/Knowledge 适合做 AI 编排；Tauri 支持 React 模板与多前端框架；React 更适合你的桌面 IDE 风格前端；Next.js 更适合全栈 Web。([Agno][1])

---

## 28. 最终选型总结

## 产品名 / repo

* **`trpg-workbench`**

## 技术栈

* **桌面壳**：Tauri
* **前端**：React + Vite + TypeScript
* **AI 后端**：Python + Agno
* **数据库**：SQLite
* **知识库**：本地 PDF + 向量索引
* **资产格式**：JSON + Markdown
* **图像能力**：外部 API，可选拓展

## 第一版定位

* 本地优先
* 通用规则框架
* COC 风格优先优化
* PDF 本地导入
* 结构化资产树
* 对话驱动生成与修改
* 建议型规则辅助
* 一键图像生成拓展

---

## 29. 一句话版本

`trpg-workbench` 应该被实现为一个 **基于 Tauri + React 的本地桌面 IDE**，以 **Python + Agno** 作为 AI 编排内核，以 **PDF 知识库 + 结构化资产树 + 对话驱动增量编辑** 作为产品核心，而不是把它做成单纯的聊天生成器。

---

## 30. 相关链接

[1]: https://docs.agno.com/introduction?utm_source=chatgpt.com "Introduction - Agno"
[2]: https://v2.tauri.app/start/create-project/?utm_source=chatgpt.com "Create a Project - Tauri"
