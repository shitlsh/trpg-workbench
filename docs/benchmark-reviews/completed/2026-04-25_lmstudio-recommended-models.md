---
status: completed
date: 2026-04-25
source: 基于 local-first 产品原则 + 用户明确诉求
theme: 模型配置体验
priority: medium
affects_creative_control: no
affects_workbench_collab: no
recommended_action: code
---

# LM Studio 优先推荐 + 推荐模型内容优化

## 来源与借鉴理由

trpg-workbench 强调 local-first，但当前 Setup Wizard 对 LM Studio 的引导停留在"探测端口 + 快速填充 base URL"，没有推荐具体加载哪个模型。用户面对空白的 model name 字段，体验断裂。

此外，Embedding 配置（WizardStep2）没有 LM Studio 专项 preset——只有 `openai` 和 `openai_compatible` 两个选项，LM Studio embedding 完全靠用户自行摸索。

## 当前差距

- `WizardStep1LLM.tsx` 的 LM Studio preset 填充 base URL + provider，但 **model name 留空**（`probeModels()` 探测到名称后才填入，探测失败则空白）
- `MEMORY_TIERS` 常量已有推荐 slug（`qwen3-8b-q8` 等），但这些仅在 RAM 检测 + tier 匹配时用于 tooltip hint，不作为默认填充值
- `WizardStep2Embedding.tsx` 没有 LM Studio provider 选项，只有 Jina preset（调用云端 API）
- 用户若想完全本地运行，Embedding 阶段必须手动输入 `openai_compatible` + base URL + model name，完全没有引导

## 推荐的具体模型（来自用户需求）

| 用途 | 推荐模型 | 供应商 |
|------|---------|-------|
| LLM（高质量） | `qwen3-27b`（量化版，如 `qwen3-27b-q4_k_m`） | LM Studio |
| LLM（中等配置） | `qwen3-8b-q8` | LM Studio |
| Embedding | `jina-embeddings-v5-text-small-retrieval` | LM Studio（openai_compatible） |

## 适合性判断

完全适合，不增加任何技术复杂度。改动范围：
1. 更新 `MEMORY_TIERS` 推荐模型名称（面向 qwen3 系列）
2. LM Studio preset 在探测到模型时优先选 qwen3-27b，其次 qwen3-8b
3. `WizardStep2Embedding.tsx` 增加 LM Studio preset（provider=openai_compatible, base_url=http://127.0.0.1:1234, model=jina-embeddings-v5-text-small-retrieval）
4. 引导文案优化：明确说明"推荐在 LM Studio 中加载 qwen3-27b-q4_k_m"

## 对创作控制感的影响

间接改善——用户有明确的"第一步加载什么"，减少配置阶段的认知负担。

## 对 workbench 协同的影响

无直接影响。

## 对 1.0 用户价值的影响

中——对于首次使用的本地模型用户，有明确推荐能显著降低入门门槛。

## 建议落地方式

- [ ] 直接改代码（小改）：
  - `apps/desktop/src/components/setup/WizardStep1LLM.tsx`
    - 更新 `MEMORY_TIERS` 推荐模型为 qwen3 系列
    - LM Studio preset 的 `probeModels()` fallback：若探测不到模型，model name 字段显示 placeholder 提示"请在 LM Studio 中加载 qwen3-27b-q4_k_m"
  - `apps/desktop/src/components/setup/WizardStep2Embedding.tsx`
    - provider 列表增加 `lmstudio`（底层 = openai_compatible）
    - 增加"LM Studio Embedding 预设"按钮：填充 provider=openai_compatible, base_url=http://127.0.0.1:1234, model=jina-embeddings-v5-text-small-retrieval
    - 相关静态 embedding catalog JSON 中增加此模型的 entry

## 不做的理由（如适用）

不适用。

## 注意事项

- `jina-embeddings-v5-text-small-retrieval` 需要在 LM Studio 中下载后加载，Wizard 引导文案应提示这一点
- 推荐模型名称（如量化版本后缀）可能随 LM Studio 版本变化，应考虑在引导文案中说明"选择 Q4 或 Q8 量化版"而非写死完整文件名
