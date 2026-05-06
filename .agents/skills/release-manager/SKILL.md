---
name: release-manager
description: >
  管理 trpg-workbench 的版本发布流程。当用户说"发版"、"打 tag"、"release"、
  "发布 vX.Y.Z"、"准备新版本"、"更新 changelog"、"写 release notes"、
  "CI 失败重跑"、"重新触发"、"删除 tag" 时必须加载本 skill。
  本 skill 会引导完整的发版流程：生成 changelog 草稿 → 润色为用户友好文本 →
  确认后更新 CHANGELOG.md → 打 tag 并 push 触发 CI。
  也包含 CI 失败后删除 tag 重打的处理流程。
---

# Release Manager

trpg-workbench 的发版流程工具。执行完整发版步骤，确保 changelog 对用户友好可读，
所有步骤在确认后才推送 tag 触发 CI。

## 背景

- `CHANGELOG.md` 是单一事实来源，CI 从中提取对应版本段落作为 GitHub Release body
- CI 流程：build jobs 并行（aarch64-apple-darwin + x86_64-pc-windows-msvc）→ 全部成功后 `publish-release` job 创建 release draft
- git tag 是触发 CI 的唯一入口，打 tag 前必须确认 changelog 内容正确
- **Re-run 无效**：CI 失败后 Re-run 用的是打 tag 那一刻的代码，如果失败原因是代码问题，必须删 tag 修复后重打

## 发版流程

### 第一步：确认版本号

询问用户要发的版本号（如 `v0.1.1`），或从对话中提取。

### 第二步：生成 changelog 草稿

运行 git-cliff 生成从上一个 tag 到 HEAD 的 commit 列表：

```bash
# 查看上一个 tag
git describe --tags --abbrev=0

# 生成草稿（输出到终端预览，不写入文件）
git cliff --tag <VERSION> --unreleased --strip header
```

如果本地没有安装 git-cliff，用 git log 代替：

```bash
git log $(git describe --tags --abbrev=0)..HEAD --oneline --no-merges
```

### 第三步：润色为用户友好的 changelog

将原始 commit 列表转化为用户可读内容，规则：

- **不要**逐行翻译 commit message，而是**归纳用户感知到的变化**
- `feat:` commits → **新功能** 分组，用产品语言描述（"支持 xxx" 而非 "add xxx"）
- `fix:` commits → **修复** 分组，描述修了什么问题（"修复了 xxx 的问题"）
- `perf:` commits → 可并入新功能或修复，视影响大小决定
- `chore:` / `ci:` / `docs:` commits → **通常省略**，除非对用户有直接影响
- 技术细节（函数名、文件名、PR 号）**不出现**在用户可见内容中
- 如果某个版本没有用户可感知的变化（纯内部重构），写一行"内部优化与稳定性改进"

**格式模板：**

```markdown
## v0.1.1 — YYYY-MM-DD

### 新功能
- xxx

### 修复
- 修复了 xxx 的问题

### 改进
- xxx 体验优化（可选，较小改动）
```

如果只有修复没有新功能，省略"新功能"分组，反之亦然。

### 第四步：展示润色结果，等待确认

将润色后的 changelog 展示给用户，**明确询问**：
1. 内容是否准确？
2. 措辞是否满意？
3. 有没有遗漏的重要变化？

**在用户确认之前，不要执行任何写文件或 git 操作。**

### 第五步：写入 CHANGELOG.md

用户确认后，将新版本段落插入 `CHANGELOG.md` 的 `<!-- next-release -->` 标记之后：

```markdown
# Changelog
...
<!-- next-release -->

## v0.1.1 — YYYY-MM-DD
<润色后的内容>

## v0.1.0 — ...
<原有内容>
```

使用 Edit 工具精确插入，不要覆盖已有版本的内容。

### 第六步：提交 changelog

```bash
git add CHANGELOG.md
git commit -m "chore(release): <VERSION>"
```

### 第七步：展示最终确认，等待打 tag 的指令

展示即将执行的命令：

```
git tag <VERSION>
git push origin <VERSION>
```

说明：push tag 后 CI 将自动触发，构建完成后在 GitHub Releases 页面生成 draft，
需要手动 publish。

**再次等待用户明确确认**后才执行打 tag 和 push。

### 第八步：打 tag 并 push

```bash
git tag <VERSION>
git push origin <VERSION>
```

push 完成后告知用户：
- CI 已触发，可在 GitHub Actions 页面查看进度
- 构建完成后会生成 release draft，需要手动在 GitHub Releases 页面点击 Publish

---

## CI 失败后重新触发

当 CI 构建失败，且失败原因是代码问题（已有修复 commit）时，需要删除旧 tag 重打。

> **为什么不能直接 Re-run？** GitHub Actions 的 Re-run 使用的是触发那次 workflow 时的代码快照，后续的修复 commit 不会包含在内。

### 流程

**第一步：确认当前状态**

```bash
# 确认修复 commit 已在本地
git log --oneline -5

# 确认本地有该 tag
git tag --list
```

**第二步：删除远端和本地 tag**

```bash
# 删除远端 tag（触发的 workflow 会继续跑完，不会中断）
git push --delete origin <VERSION>

# 删除本地 tag
git tag -d <VERSION>
```

**第三步：检查是否有残留的 release draft**

如果上次失败的 CI 已经跑到 `publish-release` 步骤并创建了 draft，需要手动到
GitHub Releases 页面删除该 draft，否则重打 tag 后会创建重复的 release。

通常 build 失败时 `publish-release` 不会执行（`needs: build`），可以跳过此步。

**第四步：重新打 tag 并 push**

```bash
git tag <VERSION>
git push origin <VERSION>
```

---

## 注意事项

- `tauri.conf.json` 和 `package.json` 里的 `version` 字段**不需要手动修改**，
  CI 中 `tauri-action` 会用 git tag 覆盖
- 如果 git-cliff 未安装，`git log --oneline` 是足够的替代方案
- 第一个版本（v0.1.0）的 changelog 已手写在 `CHANGELOG.md` 中，不需要生成
