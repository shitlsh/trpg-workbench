---
status: deferred
date: 2026-04-24
source: M16 B 类扩展（内部）
theme: Workflow 自动生成自定义类型资产
priority: medium
affects_creative_control: yes
affects_workbench_collab: yes
recommended_action: plan
deferred_reason: 需重构 create_module Workflow 落盘结构，风险较高；1.0 阶段手动创建已满足需求
reassess_condition: 1.0 发布后，若有 Workflow 重构需求（如支持更多资产类型路由），届时评估
---

# B1 + B2：Workflow 自动生成自定义类型资产 & 字段模板

## 背景

M16 完成了 AssetType 的开放化与自定义类型注册（A 类全部实现，commit 98e121a）。
但 Workflow 侧（`create_module.py`）仍存在一处硬编码，限制了自定义类型的自动生成能力。

## B1：create_module Workflow 自动感知自定义类型

### 当前差距

`apps/backend/app/workflows/create_module.py` 第 255-272 行的 patch 列表是基于内置 10 种类型硬编码的。
当 Director 输出的 `affected_asset_types` 中包含自定义类型（如 `spell`）时，
该 Workflow 无法识别并路由到对应 Document Agent，导致自定义类型资产只能由用户手动创建。

### 建议落地方式

重构 `create_module.py` 落盘逻辑：

1. 读取 `workspace_context["custom_asset_types"]` 列表
2. 对 Director 输出的每个 `affected_asset_type`，若不在内置列表中，用通用 Document Agent 路由处理
3. 通用 Document Agent 使用 `type_key` + `label` 构造 prompt，输出标准 Markdown 文档格式

### 推迟原因

- 需要重构 Workflow 落盘结构（patch 列表生成逻辑），改动范围较大，风险较高
- M16 阶段（1.0 前），用户可以手动在资产树中创建自定义类型资产，满足基本使用需求
- Workflow 自动生成的质量依赖 Document Agent prompt 模板，需要额外设计

## B2：自定义类型字段模板（JSON schema）

### 描述

允许用户为每种自定义资产类型定义默认字段结构（JSON schema）。
Document Agent 生成该类型资产时，按字段模板格式化输出，而不是完全自由文本。

### 依赖关系

依赖 B1 落地——B1 实现后，Document Agent 才能感知自定义类型并使用模板。
B2 评估时机：B1 完成后，根据实际使用反馈决定是否需要字段约束。

### 推迟原因

- 依赖 B1（尚未实现）
- 字段模板对 1.0 阶段价值有限，用户自由文本格式已够用
- JSON schema 管理 UI 的设计复杂度不低，风险/收益比较低

## 重新评估条件

- 1.0 发布后，若收到"Workflow 无法自动生成 spell/item 等自定义类型资产"的用户反馈
- 或 Workflow 层有其他重构需求（如多 Agent 并行路由），届时顺带评估 B1
