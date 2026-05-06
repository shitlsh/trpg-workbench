---
name: release-manager
description: >
  管理 trpg-workbench 的版本发布流程。当用户说"发版"、"打 tag"、"release"、
  "发布 vX.Y.Z"、"准备新版本"、"更新 changelog"、"写 release notes"、
  "CI 失败重跑"、"重新触发"、"删除 tag" 时必须加载本 skill。
  本 skill 由 agent 全程操作：生成 changelog → 润色 → 写入文件 → commit → push →
  用 gh CLI 触发 GitHub Actions workflow。用户只需在各步骤确认内容即可。
---

# Release Manager

trpg-workbench 发版的完整自动化流程。Agent 通过 gh CLI 完成从 changelog 到触发 CI 的所有操作，用户只需逐步确认。

## 背景与架构

- `CHANGELOG.md` 是唯一的 release notes 来源，格式为 `## v{version} — YYYY-MM-DD`
- **触发方式**：由 agent 执行 `gh workflow run release.yml -f version={version}`
- CI (`prepare-release` job) 在运行时会：
  1. 从 `CHANGELOG.md` 提取对应版本段落作为 release body（使用触发时的代码，即你 push 后的状态）
  2. 更新 `tauri.conf.json` 和 `package.json` 版本号并 commit
  3. 打 git tag `v{version}`
  4. 创建 GitHub Release draft
  5. 并行构建 macOS（aarch64）和 Windows（x86_64），上传 artifacts 到 draft
- **重要**：`CHANGELOG.md` 中对应版本的段落必须在触发 workflow 前已 push 到远端，CI 才能提取到
- `tauri.conf.json` 和 `package.json` 的版本号**由 CI 自动更新**，本地不需要手动修改

---

## 完整发版流程

### 第一步：确认版本号

从对话中提取或询问用户版本号，格式为纯 semver（如 `0.1.2`，不带 `v` 前缀）。

确认后查看上一个 tag，为生成 changelog 做准备：

```bash
git describe --tags --abbrev=0
```

### 第二步：生成 changelog 草稿

优先用 git-cliff（已安装时）：

```bash
git cliff --tag v<VERSION> --unreleased --strip header
```

未安装时用 git log：

```bash
git log $(git describe --tags --abbrev=0)..HEAD --oneline --no-merges
```

### 第三步：润色为用户友好的 changelog

将原始 commit 列表转化为用户可读内容，规则：

- **不要**逐行翻译 commit message，而是**归纳用户感知到的变化**
- `feat:` → **Features** 分组，用产品语言描述功能
- `fix:` → **Bug Fixes** 分组，描述修了什么问题
- `perf:` → 视影响大小并入 Features 或 Bug Fixes
- `chore:` / `ci:` / `docs:` → **通常省略**，除非对用户有直接影响
- 技术细节（函数名、文件名）**不出现**在用户可见内容中
- 没有用户可感知变化时，写"内部优化与稳定性改进"

**格式要求**（必须严格遵守，CI 用 awk 按此格式匹配提取）：

```markdown
## v0.1.2 — YYYY-MM-DD

### Bug Fixes

- **标题**：描述

### Features

- **标题**：描述
```

- 日期用今天的实际日期
- 标题行必须是 `## v{version} — YYYY-MM-DD`（`##` + 空格 + `v` + 版本号 + ` — ` + 日期）
- 只有修复时省略 Features 分组，反之亦然

### 第四步：展示润色结果，等待用户确认

将润色后的 changelog 完整展示，明确询问：
1. 内容是否准确？有无遗漏的重要变化？
2. 措辞是否满意？

**用户确认前，不执行任何文件写入或 git 操作。**

### 第五步：写入 CHANGELOG.md

用户确认后，用 Edit 工具将新版本段落插入 `CHANGELOG.md` 的 `<!-- next-release -->` 注释之后：

```markdown
# Changelog
...
<!-- next-release -->

## v0.1.2 — YYYY-MM-DD
<润色后的内容>

## v0.1.1 — ...
<原有内容不变>
```

### 第六步：commit 并 push

```bash
git add CHANGELOG.md
git commit -m "chore(release): prepare v<VERSION>"
git push
```

push 成功后告知用户 changelog 已就绪。

### 第七步：展示即将触发的命令，等待最终确认

展示：

```
gh workflow run release.yml -f version=<VERSION>
```

说明：触发后 CI 将自动完成版本号更新、打 tag、创建 release draft、并行构建。

**等待用户明确确认后**才执行。

### 第八步：触发 workflow

```bash
gh workflow run release.yml -f version=<VERSION>
```

触发成功后，等待几秒让 workflow 出现在队列中，然后获取 run URL：

```bash
sleep 5 && gh run list --workflow=release.yml --limit=1
```

告知用户：
- CI 已触发，提供 GitHub Actions 页面链接供查看进度
- 构建完成后会生成 release draft，需要手动在 GitHub Releases 页面点击 Publish

---

## CI 失败后的回退与重新触发

### 判断失败阶段

```bash
gh run list --workflow=release.yml --limit=3
```

- **`prepare-release` job 失败**：可能已 commit 了版本号但 tag 未打，也可能 tag 已打但 release 未创建。需要按情况清理。
- **`build` job 失败**：`prepare-release` 已完成，tag 和 release draft 都已存在。Re-run 无效（Re-run 使用触发时的代码快照，后续修复 commit 不包含在内）。

### 回退流程

**第一步：确认当前状态**

```bash
# 查看失败的 run 详情
gh run view <run-id>

# 确认 tag 是否已创建
git ls-remote --tags origin | grep v<VERSION>

# 确认 release draft 是否已创建
gh release view v<VERSION>
```

**第二步：清理 release draft（如已创建）**

```bash
gh release delete v<VERSION> --yes
```

**第三步：清理 tag（如已创建）**

```bash
# 删除远端 tag
git push --delete origin v<VERSION>

# 删除本地 tag（如果存在）
git tag -d v<VERSION> 2>/dev/null || true
```

**第四步：确认修复已 push，重新触发**

```bash
# 确认修复 commit 已在远端
git log --oneline -5
git push  # 如有未推送的修复

# 重新触发
gh workflow run release.yml -f version=<VERSION>
```

---

## 注意事项

- changelog 段落格式中 `—` 是 em dash（`—`），不是普通连字符，CI 的 awk 按此精确匹配
- `gh workflow run` 需要本地已通过 `gh auth login` 认证，且对该 repo 有 write 权限
- 如果 git-cliff 未安装，`git log --oneline` 完全够用
