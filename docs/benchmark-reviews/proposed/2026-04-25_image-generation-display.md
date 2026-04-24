---
status: proposed
date: 2026-04-25
source: Internal (M19 agent-context-control review spillover)
theme: 图片生成结果展示
priority: low
affects_creative_control: yes
affects_workbench_collab: no
recommended_action: fix
---

# 图片生成结果展示

## 问题

当前图片生成流程（`generate_image.py`）可以调用 DALL-E 3 或本地 Stable Diffusion 生成图片并保存到磁盘，但生成结果**从未在 UI 中渲染**：

- `image_brief.generated_image_path` 保存了路径，但资产编辑器和聊天面板都没有 `<img>` 渲染逻辑
- `ImageGenerationJobORM` 记录了任务历史，但没有查看任务列表的 UI
- 用户生成图片后只能手动去文件系统找 PNG 文件

## 目标

生成的图片在资产编辑器和/或聊天面板中直接可见。

## 设计

### 资产编辑器中的图片展示

- 当资产的 `image_brief.generated_image_path` 存在时，在编辑器顶部或侧边显示缩略图
- 点击可查看大图
- 支持"重新生成"按钮

### 聊天面板中的图片展示

- 当 Agent 完成图片生成 tool-call 后（M19 架构下），在 ToolCallCard 中直接展示生成结果

### 涉及改动

| 模块 | 改动 |
|------|------|
| `AssetEditor.tsx` 或 `MarkdownPreview` 组件 | 读取 image_brief，渲染图片 |
| Tauri asset protocol | 注册本地文件路径为可访问的 asset URL |

## 建议落地方式

- [ ] 可作为小型修复并入任意后续 milestone
- [ ] M19 中如果图片生成也迁移到 tool-calling，展示逻辑可一并实现
