---
status: completed
date: 2026-04-25
source: OpenPawz / OpenCode Desktop
theme: 模型配置体验
priority: high
affects_creative_control: no
affects_workbench_collab: indirect
recommended_action: code
---

# openai_compatible 动态拉取模型列表 + Profile 表单 Picker

## 来源与借鉴理由

成熟 AI 桌面工具（OpenPawz、OpenCode Desktop）在用户配置供应商 base URL 后，会自动调用 `/v1/models` 端点拉取模型列表，用户从下拉选择而非手动输入字符串。LM Studio 暴露标准 OpenAI-compatible `/v1/models` 接口，完全可被当前 `openai_compatible` provider 复用。

## 当前差距

- 模型名称是 free-text input，用户不知道 LM Studio 里实际加载了什么模型
- `catalog_service.py` 的 `refresh_catalog_from_provider` 已支持 OpenRouter / Google / OpenAI，但**不支持 `openai_compatible`**
- Catalog Refresh 结果展示在独立的 CatalogSection tab，没有反哺到 Profile 创建/编辑表单的 picker 上
- 用户必须先去 LM Studio 界面查模型名，再回来手动输入，步骤割裂

## 适合性判断

完全适合：
- 后端 `refresh_catalog_from_provider` 框架已有，扩展 `openai_compatible` 分支只需约 20-30 行
- 前端表单改造：当 provider = `lmstudio` 或 `openai_compatible` 且 base_url 已填写时，显示"拉取模型列表"按钮，结果展示为 model name 下拉
- LM Studio 的 `/v1/models` 无需 API key

## 对创作控制感的影响

间接改善——减少 Setup 阻塞，让用户更快、更有信心地完成配置，进入创作状态。

## 对 workbench 协同的影响

间接改善——消除 onboarding 摩擦，特别是本地模型用户（核心目标用户群）。

## 对 1.0 用户价值的影响

高——首次配置时"我不知道填什么模型名"是严重的 onboarding 阻塞点，对本地模型用户尤其明显。

## 建议落地方式

- [ ] 直接改代码（后端）：
  - `apps/backend/app/services/catalog_service.py`
    - 在 `refresh_catalog_from_provider` 中新增 `openai_compatible` / `lmstudio` 分支
    - 调用 `GET {base_url}/v1/models`，解析 `id` 字段，写入 catalog（source = `"api_fetched"`）
    - LM Studio 无需 Authorization header，Ollama 也无需；通用 openai_compatible 可选传 API key

- [ ] 直接改代码（前端）：
  - `apps/desktop/src/pages/SettingsPage.tsx` LLMSection 和 EmbeddingSection 表单
    - 当 provider = `openai_compatible` / `lmstudio` 且 base_url 已填时，显示"获取模型列表"按钮
    - 点击后调用 `POST /settings/model-catalog/refresh`（传入 provider + base_url），结果填充 model name `<select>`
  - `apps/desktop/src/components/setup/WizardStep1LLM.tsx` 同步改造

## 不做的理由（如适用）

不适用——此功能明确建议实现。

## 实现细节建议

后端扩展约 30 行：

```python
elif provider_type == "openai_compatible":
    base_url = profile.base_url or "http://127.0.0.1:1234"
    headers = {}
    if profile.api_key:
        headers["Authorization"] = f"Bearer {profile.api_key}"
    resp = httpx.get(f"{base_url}/v1/models", headers=headers, timeout=5)
    resp.raise_for_status()
    for m in resp.json().get("data", []):
        # upsert to ModelCatalogEntry
        ...
```

前端 Profile 表单：base_url 填写后，model name 字段右侧出现「刷新」图标按钮，点击后 model name 变为 `<select>`（已拉取数据时）或保持 text input（拉取失败时 fallback）。
