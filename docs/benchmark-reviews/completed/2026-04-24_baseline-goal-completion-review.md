---
status: proposed
date: 2026-04-24
source: Internal (baseline goal assessment)
theme: 基础目标达成度评估
priority: high
affects_creative_control: yes
affects_workbench_collab: yes
recommended_action: defer
---

# 基础目标达成度评估：AI Agent 驱动的 TRPG 模组/剧本创作工具

## 评估目标

评估 trpg-workbench 是否已基本达成其核心定位——**通过 AI Agent 交互的方式，辅助创作 TRPG 模组/剧本**。审查范围覆盖已完成的 17 个 milestone、6 篇 Help 文档、以及全部实现代码。

---

## Section 1：当前项目已做到的部分

### 产品骨架已完成（核心链路全部打通）

| 能力维度 | 实现状态 | 关键实现 |
|---------|---------|---------|
| **多 Agent 协作创作** | 完成 | Director + Plot/NPC/Monster/Lore/Rules/Consistency/Document/Skill 共 9 个 Agent，Director 负责意图解析和调度 |
| **端到端模组生成** | 完成 | `create_module` workflow 13 步流水线：澄清→规划→确认→规则检索→大纲→场景→NPC→怪物→地点→线索链→一致性检查→格式化→持久化 |
| **人机协作流程** | 完成 | 澄清问答 → ChangePlan 确认 → Patch 确认对话框，关键节点均有用户介入 |
| **结构化资产管理** | 完成 | 10 种内置资产类型 + 自定义类型，JSON+Markdown 双格式存储，版本历史与回滚 |
| **知识库/RAG** | 完成 | PDF 导入 → 文本提取 → heading-aware 分块 → embedding → lancedb 向量索引 → 检索 → Rerank → 引用展示 |
| **规则集体系** | 完成 | RuleSet 管理、知识库绑定、PromptProfile 风格模板、workspace 继承 |
| **桌面端 UI** | 完成 | Tauri 2 桌面应用，三栏布局（Agent 面板 / 编辑器 / 资产树），Markdown 编辑器 |
| **模型配置** | 完成 | 多 Provider 支持（Gemini/OpenAI/Claude/OpenRouter/本地），LLM/Embedding/Rerank 三类模型，模型目录发现 |
| **首次引导** | 完成 | 4 步 Setup Wizard（LLM → Embedding → Rerank → Workspace） |
| **用量监控** | 完成 | Token 用量与成本估算 |

### 用户体验已完成（不只是能用，有合理的感知和反馈）

- **Director 计划可见性**：用户可以看到 Director 的执行计划并确认
- **RAG 引用可见**：CitationCard 组件展示知识来源、页码、相关度
- **Workflow 进度展示**：WorkflowProgress 组件展示多步骤执行状态
- **Patch Diff 确认**：用户可以逐项审查 Agent 提出的修改
- **Help 文档体系**：6 篇覆盖完整使用流程的中文帮助文档，含截图
- **Skill 系统**：用户可创建持久化的 Agent 指令框架，通过对话或手动方式

### 骨架到位但体验细节可进一步打磨

- **Feature Discovery**：已有 proposed review（`2026-04-23_feature-discovery-hints.md`），新用户可能不知道某些功能入口
- **Onboarding Checklist**：已有 proposed review（`2026-04-23_onboarding-checklist-profile-health.md`），Setup Wizard 之后缺少持续引导
- **内置 Skill 预设**：已有 proposed review（`2026-04-24_builtin-agent-skill-presets.md`），当前 Skill 系统需要用户从零开始写

---

## Section 2：基础目标达成度判断

### 结论：基础目标已基本达成

trpg-workbench 作为"AI Agent 驱动的 TRPG 模组/剧本创作工具"，其核心价值链已完整闭环：

```
用户输入创作意图
  → Director 解析意图并澄清
  → 用户确认执行计划
  → 多 Agent 协作生成（Plot/NPC/Monster/Lore，RAG 注入规则知识）
  → Rules 审查 + Consistency 检查
  → Document 格式化输出
  → 用户确认 Patch 并持久化资产
  → 后续可编辑、回滚、再次修改
```

这条链路从代码到 UI 到文档全部打通，不存在断裂的环节。

### 与基础目标的逐项对照

| 基础目标要素 | 达成情况 | 说明 |
|-------------|---------|------|
| "通过 AI Agent 交互" | **完全达成** | 9 个 Agent 各司其职，Director 统一调度 |
| "辅助创作" | **完全达成** | 人机协作流程完整，用户在关键节点有控制权 |
| "TRPG 模组/剧本" | **完全达成** | 10 种资产类型覆盖模组核心元素（大纲、场景、NPC、怪物、地点、线索、分支、时间线、地图、世界观） |
| "工具" | **完全达成** | 桌面应用形态，本地数据存储，可配置模型 |

---

## Section 3：是否还有明显需要添加的内容

### 无功能性硬缺口

从"能否用这个工具完成一个 TRPG 模组的创作"角度看，不存在阻塞性的功能缺失。用户可以：
1. 配置模型 → 2. 导入规则书 → 3. 创建工作区 → 4. 通过 Agent 对话生成模组 → 5. 编辑和调整 → 6. 导出资产

### 可改善但非必需的方向（已有 proposed review 跟踪）

以下三个方向已在 `docs/benchmark-reviews/proposed/` 中有对应 proposal，属于"锦上添花"而非"基础缺失"：

1. **Feature Discovery Hints** — 帮助用户发现已有功能
2. **Onboarding Checklist / Profile Health** — Setup Wizard 后的持续引导
3. **内置 Agent Skill 预设** — 降低 Skill 使用门槛

### 值得关注但不阻塞基础目标的潜在方向

| 方向 | 当前状态 | 是否阻塞基础目标 | 建议 |
|------|---------|----------------|------|
| **模组导出/分享** | 资产以 JSON+MD 存储在本地，无打包导出功能 | 否（用户可直接使用文件） | 1.0 后可考虑 PDF/HTML 导出 |
| **多轮迭代创作体验** | 有 modify_asset workflow | 否 | 体验可持续打磨 |
| **协作/多人** | 无，本地单用户 | 否（定位为个人工具） | 超出当前定位 |
| **模板/示例模组** | 无内置示例 | 否（Help 文档已覆盖流程说明） | 可作为 onboarding 增强 |
| **Agent 执行过程中间状态可见性** | 有 WorkflowProgress，但细粒度有限 | 否 | 可持续改善 |

---

## Section 4：优先级结论

### Top 1：当前基础目标已达成，不需要新增必要功能

- 建议行动：仅记录
- 预估影响：N/A
- 创作控制感提升：N/A
- workbench 协同改善：N/A
- 说明：17 个 milestone 全部完成，核心创作链路闭环，Help 文档覆盖完整。项目已具备作为"AI Agent 驱动的 TRPG 模组创作工具"的基本可用性。

### Top 2：处理现有 3 个 proposed review

- 建议行动：评估是否纳入下一轮 milestone
- 预估影响：中
- 创作控制感提升：间接（降低使用门槛）
- workbench 协同改善：间接
- 触发条件：当准备做 1.0 正式发布前的打磨时

### Top 3：模组导出功能

- 建议行动：先不做
- 预估影响：中
- 创作控制感提升：有（用户可以将成果带出工具）
- workbench 协同改善：无
- 触发条件：当有用户反馈"创作完成后不知道怎么使用"时

---

## 总结

trpg-workbench 已经是一个**功能完整的 AI Agent 驱动 TRPG 创作工具**。它不是一个半成品——从模型配置、知识库导入、Agent 协作创作、人机交互确认、到资产管理和帮助文档，所有核心环节都已实现并串联。当前的 3 个 proposed review 属于体验优化层面，不影响基础目标的达成判断。
