---
status: proposed
date: 2026-04-26
source: OpenCode Desktop, Inscriptor
theme: 自我修正与 Agent 循环能力
priority: low
affects_creative_control: indirect
affects_workbench_collab: indirect
recommended_action: defer
---

# 自我修正与 Agent 循环能力（调研结论）

## 来源与借鉴理由

OpenCode Desktop 有两层自我修正：(1) lint/test 执行后失败自动重试；(2) `/compact` 手动触发上下文压缩+摘要。Inscriptor 对 AI 生成内容的修正是通过"用户标注 + 重写"而非 agent 自动循环。

## 当前差距

Director Agent 是完全的单次 pass，无重试、无自我审查、无 output-then-validate 循环。Consistency Agent 和 Rules Agent 的返回结果完全依赖 Director 自愿调用，且无代码强制 check-then-fix 循环。

## 适合性判断

当前不适合。见下方"不做的理由"。

## 对创作控制感的影响

间接——如果 Agent 自我修正准确，创作质量提升；但如果修正偏离用户意图，反而削弱控制感

## 对 workbench 协同的影响

间接改善（如果可靠）

## 对 1.0 用户价值的影响

低。在 Agent 基础稳定性未解决前，自我修正带来的额外价值有限。

## 建议落地方式

- [ ] 暂缓。触发重新评估的条件（需同时满足）：
  1. Consistency Agent 和 Rules Agent 在 10 次测试中有 8 次返回正确结构化结论
  2. max_steps 保护已实施，Agent 基础稳定性已验证
  3. 本地模型升级到 70B 级别，或主要用 API 模型（GPT-4o / Claude Sonnet）

## 不做的理由

1. **成本大**：自我修正需要 Agent 可靠地读取自己的输出、构造有效修正 prompt、再执行写入——对当前 Qwen 27B 模型的 instruction-following 能力要求过高，连第一遍都不稳定的情况下加自我修正会放大问题
2. **先决条件未满足**：Consistency Agent 和 Rules Agent 刚修复 `instructions=[]` bug，尚未验证可靠性
3. **TRPG 创作场景更适合用户介入修正**：创作者有明确的风格偏好，Agent 自我修正可能偏离用户意图。更好的模式是"Agent 提出修正建议 → 用户确认 → 执行"，而非自动循环
