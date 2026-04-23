---
status: proposed
date: 2026-04-23
source: Inscriptor / OpenCode Desktop
theme: Help 页面交互增强（UI 层）
priority: medium
affects_creative_control: indirect
affects_workbench_collab: no
recommended_action: code
---

# Help 页面交互增强（UI 层）

> **注意：** 文档内容质量与生成机制的分析见独立 review：`2026-04-23_help-doc-generation-mechanism.md`。本文件仅覆盖 Help 页面 UI 交互层的改进。

## 来源与借鉴理由

对照 Inscriptor（上下文帮助入口 + 文档内链跳转）和 OpenCode Desktop（文档内导航），评估 HelpPage 交互层的改进方向。

## 当前差距

1. **上下文感知 Help 入口**：仅首页有 HelpButton，功能页面内无帮助入口
2. **文档内链无法跳转**：ReactMarkdown 的 `<a>` 不支持 React Router 导航
3. **文档内截图无法渲染**：`?raw` 导入的 Markdown 中图片路径不会被 Vite 处理

## 建议落地方式（直接改代码）

- [ ] 各功能页面头部加 HelpButton，跳转到对应 help doc
- [ ] HelpPage.tsx ReactMarkdown 加 custom link renderer（`/` 开头用 navigate()）
- [ ] HelpPage.tsx ReactMarkdown 加 custom image renderer（解析 `src/help/images/` 路径）

## 明确不做

- **Tauri 原生 Help 菜单**：之前试过不好用，且不利于 web 版兼容
- **Help 搜索**：5 篇文档量不需要搜索
- **多语言文档**：1.0 目标用户为中文用户
