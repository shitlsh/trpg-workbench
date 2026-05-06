# Changelog

All notable changes to TRPG Workbench will be documented in this file.

<!-- next-release -->

## v0.1.1 — 2026-05-06

### Bug Fixes

- **Windows 启动失败修复**：PyInstaller 打包时 `uvicorn.run("app.main:app")` 字符串形式无法被静态分析，导致 `app.main` 模块未被打入 bundle，启动报 `could not import module "app.main"`。改为直接 `import` 对象传入解决。
- **Windows CHM 支持**：放弃在 MSVC 上编译 pychm（chmlib 依赖 POSIX 头文件），改用 Windows 内置的 `hh.exe -decompile` 解包 CHM，零依赖，功能对等。

### Features

- **完整日志体系**：所有层的日志统一输出到 `~/trpg-workbench-data/logs/`
  - `backend.log`：Python 后端 uvicorn 请求日志、业务异常、启动错误（RotatingFileHandler，5 MB × 3 份轮转）
  - `app.log`：Rust 层、前端 JS 错误、未捕获异常、sidecar stdout/stderr
  - 排查问题时提供此目录下两个文件即可

## v0.1.0 — 2026-05-06

Initial release.

### Features

- AI Agent 对话面板，支持多轮工具调用、思考链（DeepSeek / Qwen3）流式输出
- 资产系统：NPC、场景、地点、线索等结构化资产的创建、编辑、版本历史
- 知识库：PDF / CHM 文档导入、向量检索（`search_knowledge`）
- 多 LLM 供应商支持：OpenAI、Google Gemini、OpenRouter、本地 OpenAI 兼容（LM Studio 等）
- 工作空间管理：多项目隔离，本地文件系统存储
- Director Agent 调度框架：Consistency / Rules / Skill Agent 工具化委托
- 一致性检查（`check_consistency`）：跨资产矛盾检测
- 规则咨询（`consult_rules`）、世界观检索（`consult_lore`）
- 流式打字机效果、工具调用卡片、思考块折叠展示
- 停止生成后自动保存已输出内容
- 同名工具调用批量折叠摘要卡片
