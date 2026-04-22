# Benchmark Reviews

对标参考项目的 review 结论存档。每次运行 `desktop-benchmark-review` skill 后，将结论按状态分类存入对应子目录。

## 目录结构

| 目录 | 含义 |
|------|------|
| `proposed/` | 新提出的 review 结论，尚未决策 |
| `accepted/` | 已决定要做的改进方向（通常会对应一个 milestone task 或 plan 条目） |
| `rejected/` | 明确决定不做的方向，附理由 |
| `completed/` | 已落地完成的改进 |
| `deferred/` | 暂缓（认可价值但当前阶段不优先，或等待前置条件） |

## 文件命名约定

```
YYYY-MM-DD_<主题简述>.md
```

例如：
- `2026-04-23_startup-error-recovery.md`
- `2026-04-23_model-config-abstraction.md`

## 状态迁移流程

```
proposed/ → accepted/   （决定要做，写入 plan）
proposed/ → rejected/   （决定不做，记录理由）
proposed/ → deferred/   （暂缓，记录原因和重新评估条件）
accepted/ → completed/  （milestone 完成后移入）
```

当文件状态变更时，将其移动到对应目录，并在文件顶部更新 `status` 字段。

## 参考对象

当前默认对标参考对象：
- **OpenCode Desktop** — 桌面端启动/恢复、模型配置、prompt 输入体验、help/onboarding
- **Inscriptor** — 创作型 workspace UI 信息架构、内容组织方式
- **OpenPawz** — 本地优先桌面 AI 产品骨架、provider/model 抽象
