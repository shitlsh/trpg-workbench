---
name: dev-env-setup
description: 在新机器上从零搭建 trpg-workbench 开发环境的完整步骤指南。当在新电脑上克隆项目、遇到环境初始化问题、或需要重建开发工作空间时必须加载本 skill。包括：安装 Node.js/pnpm/Rust/Python/Tauri CLI、处理 macOS 常见 pip 限制、venv 创建、前后端依赖安装、验证后端启动，以及已知坑点的解决方案。
---

# Skill: dev-env-setup

## 用途

在新机器（macOS）上从零将 `trpg-workbench` 开发环境搭建到可以 `cargo tauri dev` 的状态。本 skill 记录了实际踩过的坑和对应解法，避免重复排查。

---

## 前置条件检查

在开始安装前，先确认当前环境：

```bash
node --version       # 需要 >= 20
pnpm --version       # 需要 >= 9
python3 --version    # 系统自带是 3.9，不够用，见下文
rustc --version      # 需要 >= 1.70
cargo tauri --version
```

---

## 1. Node.js

推荐使用 [nvm](https://github.com/nvm-sh/nvm) 或直接从 [nodejs.org](https://nodejs.org) 安装 LTS（>= 20）。

```bash
# 验证
node --version   # v20.x 或更高
```

---

## 2. pnpm

```bash
npm install -g pnpm

# 验证
pnpm --version   # 10.x
```

---

## 3. Rust 工具链

macOS 不自带 Rust，必须通过 rustup 安装：

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
```

安装完成后，**当前 shell 需要 source 环境变量**，否则 `rustc`/`cargo` 命令找不到：

```bash
source "$HOME/.cargo/env"

# 验证
rustc --version   # rustc 1.95.0 或更高
cargo --version
```

> 建议将 `source "$HOME/.cargo/env"` 加入 `~/.zshrc` 或 `~/.bashrc`，避免每次新开终端都要手动 source。

---

## 4. Tauri CLI

Rust 环境就绪后安装 Tauri CLI（编译耗时约 2-3 分钟）：

```bash
source "$HOME/.cargo/env"   # 如果还没 source
cargo install tauri-cli

# 验证
cargo tauri --version   # tauri-cli 2.x
```

---

## 5. Python（必须用 Homebrew，不能用系统 Python）

macOS 系统自带的 Python 3.9（位于 `/usr/bin/python3`，由 Apple Command Line Tools 提供）有版本和 pip 限制，**不能用来创建后端 venv**。

必须用 Homebrew 安装 Python 3.13：

```bash
# 如果还没有 Homebrew：
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 安装 Python 3.13
brew install python@3.13

# 验证路径
which python3.13          # /opt/homebrew/bin/python3.13（Apple Silicon）
                          # /usr/local/bin/python3.13（Intel Mac）
python3.13 --version      # Python 3.13.x
```

---

## 6. 前端依赖

```bash
# 在仓库根目录
cd /path/to/trpg-workbench
pnpm install
```

这会同时安装 `apps/desktop` 和 `packages/shared-schema` 的依赖，并建立 workspace 软链接。

---

## 7. 后端 venv 与依赖

### 7.1 创建 venv（必须用 Homebrew Python）

```bash
cd apps/backend

# 用 Homebrew 的 python3.13 创建 venv
/opt/homebrew/bin/python3.13 -m venv .venv

# Intel Mac 路径不同：
# /usr/local/bin/python3.13 -m venv .venv
```

### 7.2 安装依赖（必须设 PIP_USER=false）

macOS 上如果 `~/Library/Application Support/pip/pip.conf` 中有 `user = true`，在 venv 内安装时会报错：

```
ERROR: Can not perform a '--user' install. User site-packages are not visible in this virtualenv.
```

解决方法：用 `PIP_USER=false` 覆盖全局 pip 配置：

```bash
PIP_USER=false .venv/bin/pip install -r requirements.txt
```

或者一次性修改 pip 配置（适合长期使用）：

```bash
# 查看配置文件位置
cat ~/Library/Application\ Support/pip/pip.conf
# 将 "user = true" 改为 "user = false"，或删除该行
```

### 7.3 验证后端可正常启动

```bash
cd apps/backend
PIP_USER=false TRPG_DATA_DIR=/tmp/trpg-test .venv/bin/python3 -c "
from app.storage.database import init_db
from app.storage.seed import seed_default_data
init_db()
seed_default_data()
print('Backend OK')
"
# 应输出：Backend OK
```

---

## 8. 验证完整启动

### 仅后端（快速验证）

```bash
cd apps/backend
PIP_USER=false TRPG_DATA_DIR=~/trpg-workbench-data .venv/bin/python3 server.py
# 后端监听 http://127.0.0.1:7821
# 访问 http://127.0.0.1:7821/health 应返回 {"status":"ok","version":"0.1.0"}
```

### 完整桌面应用

```bash
source "$HOME/.cargo/env"   # 确保 cargo 在 PATH 中
cd apps/desktop
cargo tauri dev
# Tauri 会自动启动 Vite dev server（port 1420）并拉起 Python 后端
```

首次编译 Rust 依赖耗时较长（5-10 分钟），后续增量编译很快。

---

## 已知坑点速查

| 问题 | 原因 | 解法 |
|------|------|------|
| `rustc: command not found` | rustup 安装后未 source | `source "$HOME/.cargo/env"` |
| `pip install` 报 `user install` 错误 | `~/.../pip.conf` 有 `user = true` | 命令前加 `PIP_USER=false` |
| `python3 -m venv` 创建的 venv 装包异常 | 系统 Python 3.9 版本太低 | 改用 `/opt/homebrew/bin/python3.13` |
| `cargo tauri dev` 首次极慢 | Rust 编译所有依赖 | 正常，等待 5-10 分钟 |
| 前端报 `Cannot find module '@trpg-workbench/shared-schema'` | pnpm workspace 未链接 | 在仓库根目录运行 `pnpm install` |
| 后端端口 7821 被占用 | 上次进程未退出 | `lsof -ti:7821 \| xargs kill` |
| `lancedb` 安装失败（Rust 编译错误）| lancedb 有 Rust native extension，需要 Rust 工具链 | 确保已完成第 3 步（rustup + source），再重新 pip install |
| `lancedb` 在 Apple Silicon 报 `ImportError` | 架构不匹配的预编译轮子 | 用 `pip install lancedb --no-binary lancedb` 从源码编译 |

---

## 环境变量说明

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `TRPG_DATA_DIR` | `~/trpg-workbench-data` | 数据目录（SQLite、加密密钥、工作空间文件） |
| `PIP_USER` | 由 pip.conf 决定 | venv 内安装时设为 `false` 以绕过全局 user 配置 |

---

## 目录结构速览（安装后）

```
trpg-workbench/
  apps/
    desktop/
      node_modules/         # pnpm install 后生成
      src-tauri/target/     # cargo tauri dev 后生成（勿提交）
    backend/
      .venv/                # python3.13 -m venv .venv 后生成（勿提交）
  node_modules/             # 根目录 pnpm install 生成
~/trpg-workbench-data/      # 运行时数据目录（由后端自动创建）
  app.db
  .secret_key               # Fernet 加密密钥（chmod 600，勿提交）
```
