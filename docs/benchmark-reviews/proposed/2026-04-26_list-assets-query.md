---
status: proposed
date: 2026-04-26
source: Inscriptor
theme: list_assets 查询能力增强
priority: medium
affects_creative_control: indirect
affects_workbench_collab: yes
recommended_action: code
---

# list_assets 增加名称搜索、状态过滤、返回数量控制

## 来源与借鉴理由

Inscriptor 的内容导航支持按状态、标签、类型、关键词多维过滤，结果精确。当前 list_assets 只支持精确 type 匹配，模型需要一次性接收所有资产来"找到"某个 NPC。

## 当前差距

工具只支持一个参数 `asset_type: str`，做精确类型匹配。无名称搜索、无状态过滤、无返回数量控制。系统 prompt 里的 snapshot 限制 30 条，超出后只能调 list_assets——但返回值依然可能很大，消耗大量 token。

## 适合性判断

适合，改造成本低（内存过滤，零额外 DB 查询）。

## 对创作控制感的影响

间接改善——Agent 能更精确地定位资产，减少因"拿到太多资产不知道选哪个"导致的失误

## 对 workbench 协同的影响

改善 token 利用效率，减少 list_assets 返回值占用的上下文空间

## 对 1.0 用户价值的影响

中。工作区资产数量增多后（>50 个）会变得更重要。

## 建议落地方式

- [ ] 直接改代码：
  1. `apps/backend/app/agents/tools.py`：`list_assets` 增加参数：
     - `name_contains: str = ""`（名称模糊匹配，不区分大小写）
     - `status: str = ""`（精确匹配 draft/published/archived）
     - `limit: int = 20`（返回数量上限，默认 20）
  2. 在 `_workspace_context["existing_assets"]` 上做内存过滤后切片返回
  3. 更新 `apps/backend/app/prompts/director/system.txt` 中 list_assets 的说明

## 不做的理由

无理由不做，改动范围极小。
