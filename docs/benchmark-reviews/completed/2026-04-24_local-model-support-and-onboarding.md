---
status: completed
date: 2026-04-24
completed_date: 2026-04-24
implementation: direct-code
source: OpenPawz / OpenCode Desktop
theme: 本地模型支持与 Onboarding 引导
priority: high
affects_creative_control: indirect
affects_workbench_collab: no
recommended_action: code
---

# 本地模型支持与 Onboarding 引导改进

## 来源与借鉴理由

**OpenPawz（次参考）**：其 provider/integration 抽象层有成熟的"本地模型快速接入"体验——preset 选择 → 端口自动填入 → api_key 标注为可选。

**OpenCode Desktop（补充参考）**：provider config 在配置向导中为 local provider 提供专属分类和硬件提示，让用户在配置阶段就感知"是否适合本机运行"。

## 当前差距

1. **技术支持已存在，但完全不可发现**：`openai_compatible` provider 类型可对接 Ollama（`http://localhost:11434/v1`）和 LM Studio（`http://localhost:1234/v1`），但没有任何文档、preset 或提示说明这一点
2. **API Key 字段强制非空**：`WizardStep1LLM.tsx:101` 中 `!form.api_key` 导致本地模型用户无法通过向导提交（本地服务无需 key）
3. **帮助文档零覆盖**：`model-setup.md` 完全未提及本地模型；`getting-started.md` 的向导说明中没有本地模型选项
4. **无推荐模型信息**：用户不知道哪些本地模型适合 TRPG 创作、需要什么硬件配置

## 适合性判断

完全适合。架构已具备所有基础：`openai_compatible` provider、preset 机制、help doc 系统。所需改动全部属于"补充引导层"，不影响任何现有架构边界。

## 对创作控制感的影响

间接改善。降低配置门槛，使更多用户（无云端 API Key 的用户）能成功启动，从而进入创作工作流。

## 对 workbench 协同的影响

无直接影响（Provider 层改变不影响左栏/中栏/右栏协同）。

## 对 1.0 用户价值的影响

**高价值，建议在 1.0 前完成**。其中 API Key 阻塞问题属于功能性 bug，本地模型用户无法完成 Wizard 是硬阻塞。

## 建议落地方式

### 子任务 1：修复 api_key 阻塞（1.0 前必须）

**文件**：`apps/desktop/src/components/setup/WizardStep1LLM.tsx`

修改提交按钮的 disabled 逻辑：
```typescript
// 当前（有 bug）：
disabled={!form.name || !form.model_name || !form.api_key || createMutation.isPending}

// 修复后：
const needsApiKey = form.provider_type !== "openai_compatible";
disabled={!form.name || !form.model_name || (needsApiKey && !form.api_key) || createMutation.isPending}
```

同时将 api_key 字段的 placeholder 更新为本地模式提示：
```typescript
placeholder={form.provider_type === "openai_compatible" ? "本地模型可填 'ollama' 或留空" : "AIza..."}
```

**文件**：`apps/backend/app/agents/model_adapter.py`
确认 `openai_compatible` 路径在 api_key 为空或 "ollama" 时仍可正常创建 client（已支持，无需改动）。

---

### 子任务 2：Wizard 增加本地模型快速填入 preset

**文件**：`apps/desktop/src/components/setup/WizardStep1LLM.tsx`

在现有 Gemini preset banner 下方增加本地模型 preset 区域：

```tsx
{/* LM Studio preset */}
<button onClick={() => setForm({
  ...form, provider_type: "openai_compatible",
  base_url: "http://localhost:1234/v1",
  model_name: "lmstudio-community/Qwen2.5-14B-Instruct-GGUF",
  api_key: "lm-studio", name: "LM Studio 本地模型",
  supports_json_mode: true, supports_tools: false,
})}>填入 LM Studio 推荐值</button>

{/* Ollama preset */}
<button onClick={() => setForm({
  ...form, provider_type: "openai_compatible",
  base_url: "http://localhost:11434/v1",
  model_name: "qwen2.5:14b",
  api_key: "ollama", name: "Ollama 本地模型",
  supports_json_mode: false, supports_tools: false,
})}>填入 Ollama 推荐值</button>
```

同时添加说明文案：
> 本地模型无需 API Key，运行于你的电脑，数据不离本机。推荐 ≥16GB 内存运行 14B 模型，≥10GB 可运行 7B 模型。

---

### 子任务 3：更新帮助文档

**文件**：`apps/desktop/src/help/model-setup.md`

在「LLM 语言模型」章节末尾增加「本地模型（离线运行）」小节：

#### 内容大纲
- **什么是本地模型**：运行在你电脑上的模型，无需 API Key，数据不离本机
- **支持方式**：通过「OpenAI Compatible」供应商，填写本地服务地址
- **推荐软件**：LM Studio（GUI 友好）、Ollama（命令行）
- **推荐模型列表**（2026 Q2 时效）：

| 模型 | 推荐量化 | 最低内存 | 适合场景 |
|------|---------|---------|---------|
| Qwen2.5-14B-Instruct | Q4_K_M | 10GB | TRPG 创作主力，中文优秀 |
| Qwen3-30B-A3B（MoE） | Q4_K_M | 16GB | 高质量，激活参数少 |
| Gemma3-12B-it | Q4_K_M | 10GB | 英文创作，工具调用支持好 |
| Gemma3-27B-it | Q4_K_M | 20GB | 旗舰本地模型 |
| Qwen2.5-7B-Instruct | Q4_K_M | 6GB | 入门，创作质量受限 |

- **Embedding 本地方案**：`nomic-embed-text`（Ollama）或 `text-embedding-nomic-embed-text-v1.5`（LM Studio）
- **Base URL 配置**：LM Studio → `http://localhost:1234/v1`，Ollama → `http://localhost:11434/v1`
- **注意事项**：本地模型的 `supports_tools` 和 `supports_json_mode` 能力因模型而异，建议先测试，不稳定时可关闭

**文件**：`apps/desktop/src/help/getting-started.md`

在「第一步：配置 LLM 模型」章节增加说明：
> 如果你的电脑内存 ≥16GB，也可以选择运行本地模型（无需 API Key）。详见 [本地模型配置](/help/model-setup#本地模型)。

---

### 子任务 4（可选，中期）：Python 后端 RAM 检测

**文件**：`apps/backend/app/api/settings.py`（新增接口）

```python
GET /settings/system-info
# 返回：{ "total_ram_gb": 32, "platform": "darwin" }
# 依赖：psutil（已在 requirements 中或轻量添加）
```

**前端**：Wizard 启动时调用，≥16GB 显示"本地模型适合你的电脑"，<12GB 显示"建议使用云端模型"。

此子任务依赖 psutil 引入，建议评估后决定是否纳入本次改动。

---

## 不做的部分

- **Tauri 系统信息插件**（tauri-plugin-os）：需修改 Cargo.toml 和 Tauri 配置，成本高于 Python psutil，暂不引入
- **动态 Ollama 模型目录刷新**：需要对接 `http://localhost:11434/api/tags`，可在后续有需求时增加
- **显存（VRAM）检测**：跨平台复杂（macOS unified memory、NVIDIA/AMD 分别处理），1.0 前不做

## 落地检查清单

- [ ] 直接改代码：`WizardStep1LLM.tsx` api_key 阻塞 fix
- [ ] 直接改代码：`WizardStep1LLM.tsx` 增加 LM Studio / Ollama preset
- [ ] 直接改代码：`model-setup.md` 增加本地模型章节
- [ ] 直接改代码：`getting-started.md` 增加本地模型提示
- [ ] 可选 plan：Python 后端 RAM 检测接口（中期追加）
