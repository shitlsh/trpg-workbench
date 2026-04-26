---
status: proposed
date: 2026-04-26
source: OpenCode Desktop
theme: 部分文件编辑（搜索/替换）
priority: high
affects_creative_control: yes
affects_workbench_collab: yes
recommended_action: code
---

# patch_asset：str_replace 工具替代全文重写

## 来源与借鉴理由

OpenCode Desktop 的文件编辑核心工具是 `str_replace`——模型只需提供 `old_str` 和 `new_str`，不必持有完整文件内容即可精确修改特定段落。这是解决大文件 token 消耗问题的关键机制。

## 当前差距

`update_asset` 要求完整的 `content_md`。对于一个 3000 字的冒险大纲，只改一个 NPC 名字也要把全文塞入上下文——对本地 4096~16384 token 模型来说是极大负担，也是 update 类操作成功率低的主要原因。

## 适合性判断

非常适合，且是当前最实际的 token 压缩手段。TRPG 资产文件普遍篇幅长（冒险大纲 1000~5000 字），全文重写是对本地模型最大的负担。

## 对创作控制感的影响

间接改善——更精确的修改意味着更少的意外改动，用户在 confirm dialog 里看到的 diff 也更清晰

## 对 workbench 协同的影响

显著改善 Agent 的执行成功率，减少因 token 超限导致的生成截断

## 对 1.0 用户价值的影响

高。直接影响本地模型可用性，尤其对 update 类操作。

## 建议落地方式

- [ ] 直接改代码：
  1. `apps/backend/app/agents/tools.py`：新增 `patch_asset` 工具，参数 `asset_slug: str`、`old_str: str`、`new_str: str`，后端读取文件做字符串替换，仍走 `PatchProposalInterrupt` confirm 流程
  2. `apps/backend/app/prompts/director/system.txt`：引导模型优先使用 `patch_asset` 做局部修改，只在新建或大幅重写时使用 `update_asset`
  3. `apps/desktop/src/components/agent/PatchConfirmDialog.tsx`：str_replace 的 diff 展示应突出"被替换段落"与"替换后段落"的对比，比全文 diff 更清晰

## 不做的理由

无，应优先实施。
