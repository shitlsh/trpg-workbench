---
status: proposed
date: 2026-06-09
source: OpenPawz
theme: Wizard 步骤后果声明与跳过影响可见性
priority: high
affects_creative_control: yes
affects_workbench_collab: indirect
recommended_action: code
---

# Wizard 步骤缺少「跳过后果」声明，用户不知道跳过意味着什么

## 来源与借鉴理由

参考 OpenPawz 的 onboarding 流程设计：每个可选配置步骤都会在步骤头部明确说明"不配置时会损失什么能力"，而不只是描述"这个步骤是做什么的"。这类 **consequence statement** 是降低初次配置心智负担的关键机制。

## 当前差距

当前 `SetupWizardPage` + 各 `WizardStep*` 组件：

- 每个步骤只有描述性说明（「此步骤配置供应商凭据，保存后会自动验证连接是否正常」），没有后果说明
- 「稍后配置」跳过后，`WizardSummary` 仅显示灰色斜体「已跳过」字样
- Summary 末尾只有一句静态文字：「跳过的配置可以在「模型配置」页面随时补充」
- 没有根据跳过内容，具体说明功能损失

用户面临的认知困境：
- 不知道"跳过 LLM"会影响所有 AI 创作
- 不知道"跳过 Embedding"会让知识库检索完全失效
- 不知道"跳过 RuleSet"的影响比前两个小得多
- 三个跳过按钮外观一致，用户无法分辨哪个是必填哪个可选

## 适合性判断

这是**纯文案 + 少量条件渲染**的小改，不涉及架构变动。对新用户首次启动体验影响极大，是当前阶段最值得优先修的体验问题之一。

## 对创作控制感的影响

**改善**。用户在决定是否跳过某步骤时，能做出有依据的判断，而不是盲目点「稍后配置」然后进入工作台后发现 AI 不工作。

## 对 workbench 协同的影响

**间接改善**。减少"配置不完整导致功能不可用"的困惑，降低用户在 wizard 后再回头找设置的概率。

## 对 1.0 用户价值的影响

**是 1.0 前必须解决的体验问题**。Wizard 是新用户第一个接触到的界面，卡点在这里会直接导致放弃。

## 建议落地方式

### 具体修改点

**1. 各 WizardStep 步骤顶部加后果说明条**

替换当前的描述性 hint，改为结合描述 + 后果的双行格式：

```
WizardStep1LLM:
  主文案：配置 AI 语言模型供应商（OpenAI / Google / 本地模型等）
  后果声明（橙色/警告色）：⚠ 未配置时，所有 AI 创作功能不可用

WizardStep2Embedding:
  主文案：配置文本向量化模型，用于知识库语义检索
  后果声明（橙色）：⚠ 未配置时，导入的 PDF/CHM 规则书无法被 AI 检索参考

WizardStepRuleSet:
  主文案：规则集定义了工作空间的创作风格和知识体系
  后果声明（蓝色/提示色）：ℹ 可先跳过，创建工作空间后随时补绑，不影响基础写作流程

WizardStep4Workspace（工作空间）:
  主文案：创建你的第一个工作空间，每个工作空间对应一个游戏世界或模组项目
  后果声明（蓝色）：ℹ 可先跳过，回到主页后随时新建
```

**2. WizardSummary 跳过项说明具体化**

修改 `SummaryRow` 组件，根据跳过的是哪一步显示不同的能力损失说明：

```
LLM（已跳过）→ 「AI 创作功能暂不可用，请在模型配置页补充」
Embedding（已跳过）→ 「知识库检索暂不可用，请在模型配置页补充」
规则集（已跳过）→ 「可在工作空间设置中随时绑定」
工作空间（已跳过）→ 「可在主页新建工作空间」
```

**3. 如果 LLM 和 Embedding 都被跳过，Summary 顶部显示一个醒目的总结警告**

```
⚠ 你跳过了 LLM 和 Embedding 配置，AI 功能暂时不可用。
  点击「开始使用」后，可在菜单 → 模型配置 中补充。
```

- [x] 直接改代码：
  - `apps/desktop/src/components/setup/WizardStep1LLM.tsx` — 替换 hint 为后果声明
  - `apps/desktop/src/components/setup/WizardStep2Embedding.tsx` — 同上
  - `apps/desktop/src/components/setup/WizardStepRuleSet.tsx` — 同上
  - `apps/desktop/src/components/setup/WizardStep4Workspace.tsx` — 同上
  - `apps/desktop/src/components/setup/WizardSummary.tsx` — 跳过项具体化 + 全跳过警告

## 不做的理由（如适用）

N/A，建议直接做。
