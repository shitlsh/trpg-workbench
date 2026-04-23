---
status: completed
date: 2026-04-23
completed_date: 2026-04-23
source: Inscriptor
theme: workbench 协同
priority: high
affects_creative_control: indirect
affects_workbench_collab: yes
recommended_action: code
---

# Agent 完成写入后应自动打开编辑器 Tab

## 来源与借鉴理由

Inscriptor 在 AI 生成内容落盘后，工作区会自动定位到新内容——用户不需要手动去"找"刚刚
生成了什么。这是 workbench 协同的核心体验：AI 写完什么，用户立刻就在编辑区看到什么，
形成"AI 操作 → 用户感知"的完整闭环。

## 当前差距

trpg-workbench 在 Workflow 完成后只执行：

```tsx
queryClient.invalidateQueries({ queryKey: ["assets"] });
```

左栏资产树会刷新，但中栏编辑器完全没有响应。用户必须手动点击资产树才能看到新资产内容。

对于 `create_module` Workflow（会创建 10+ 个资产），用户甚至不知道应该先点哪个资产看，
因为 Workflow 完成信息中只显示步骤完成，没有"跳转到主要产出"的入口。

## 适合性判断

高度适合，架构上已经具备条件：

- `useEditorStore` 中有 `openTab(assetId)` 方法
- Workflow 完成时知道 `affected_asset_ids`
- `AgentPanel.tsx` 的 Workflow 完成回调中可以调用 `openTab`

改动方案：
1. 在 Workflow 完成时（status === "completed"），从 Workflow state 读取 `affected_asset_ids`
2. 自动打开第一个（或主要的）资产 Tab：`openTab(affected_asset_ids[0])`
3. 若是 `create_module`，优先打开 plot 类型的资产（主线剧情），其余在后台加载

## 对创作控制感的影响

间接改善。用户不再需要"主动寻找 AI 产出"，结果自动出现在视野中心，减少了"AI 到底做了什么"
的困惑感，提升 Agent 行为的可感知性。

## 对 workbench 协同的影响

直接改善右栏 Agent 面板 → 中栏编辑器的核心联动路径。这是三栏协同中最重要的反馈环：
右栏驱动 AI 操作，中栏呈现结果，左栏反映资产树变化。当前中间这一环断开。

## 对 1.0 用户价值的影响

高。这是新用户最容易困惑的场景——"我发了指令，Agent 说做完了，但我在哪里看结果？"
用户需要靠自己发现"去左侧资产树里找"，这个步骤没有任何引导。

## 建议落地方式

- [x] 直接改代码：
  - `apps/desktop/src/components/agent/AgentPanel.tsx`
    — Workflow 完成回调中，调用 `useEditorStore.openTab(affected_asset_ids[0])`
  - 如有必要，后端 `GET /workflows/{id}` 响应中确保 `affected_asset_ids` 在完成时不为空

## 不做的理由（如适用）

不适用。这是零架构成本的联动修复，延迟做没有合理理由。
