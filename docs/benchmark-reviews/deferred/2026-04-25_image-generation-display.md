---
status: proposed
date: 2026-04-25
updated: 2026-04-25
source: Internal (M19 agent-context-control review spillover)
theme: 图片生成与展示（基于 tool-calling 架构）
priority: low
affects_creative_control: yes
affects_workbench_collab: no
recommended_action: plan
---

# 图片生成与展示

## 问题

M19 清理了旧的 `generate_image` workflow 和所有相关代码（`ImageGenerationJobORM`、`ImageBrief`、`AssetMetaPanel.ImageSection` 等）。清理后，应用不再具备任何图片生成能力。

TRPG 模组创作中，场景插图、NPC 肖像、怪物图鉴等视觉素材对最终产品质量有重要辅助作用。需要在 M19 tool-calling 架构基础上重新实现图片生成，并确保生成结果在 UI 中可见。

## 目标

用户能在对话中自然请求生图（"给赵探长画一张肖像"），Agent 通过 tool-calling 调用生图 API，结果在聊天面板和资产编辑器中直接可见。

---

## 设计

### 后端：`generate_image` tool

作为 Director 的一个工具函数注册，遵循 M19 tool-calling 模式：

```python
@tool
def generate_image(
    prompt: str,
    asset_id: str | None = None,
    style: str = "realistic"
) -> dict:
    """根据文字描述生成图片。可选关联到指定资产。

    Args:
        prompt: 图片描述（英文，详细的视觉描述）
        asset_id: 可选，关联的资产 ID，生成后图片路径写入资产 frontmatter
        style: 风格提示，如 realistic, illustration, sketch
    """
    # 1. 调用图片生成 API（DALL-E 3 / 其他 provider）
    # 2. 保存图片到 workspace 目录：{workspace}/images/{timestamp}_{slug}.png
    # 3. 若 asset_id 存在，将图片路径写入资产 frontmatter 的 image 字段
    # 4. 返回结果
    return {
        "success": True,
        "image_path": saved_path,        # 磁盘绝对路径
        "image_url": tauri_asset_url,    # Tauri asset protocol URL，前端可直接渲染
        "summary": f"已生成图片：{prompt[:50]}..."
    }
```

**关键行为**：
- 这是一个**写入类工具**，但不走 PatchProposal 确认流程——图片生成成本较高（API 调用 + 等待时间），生成后直接保存，用户不满意可要求"重新生成"
- 若关联了 asset_id，图片路径写入资产 frontmatter 的 `image` 字段（非旧的 `image_brief` 结构）
- Agent 调用前会自行决定是否需要生图（基于用户请求和上下文），不需要用户手动触发

**图片存储**：
```
{workspace_dir}/
  images/
    20260425_143022_zhao_detective.png
    20260425_143500_dock_scene.png
```

**Provider 支持**：
- 初期只支持 OpenAI DALL-E 3（通过 LLM Profile 中配置的 API key）
- Provider 选择通过工作空间配置或模型配置决定，不硬编码

### 前端：聊天面板中的图片展示

Agent 调用 `generate_image` tool 后，SSE 事件流中：

```
event: tool_call_start
data: {"id": "tc_3", "name": "generate_image", "arguments": {"prompt": "..."}}

event: tool_call_result
data: {"id": "tc_3", "success": true, "summary": "已生成图片", "data": {"image_url": "asset://..."}}
```

`ToolCallCard` 检测到 `name === "generate_image"` 且 `data.image_url` 存在时，在卡片内渲染 `<img>`：
- 默认显示中等尺寸缩略图
- 点击可弹出大图查看
- 卡片底部显示"重新生成"按钮（发送新消息让 Agent 重新调用 tool）

### 前端：资产编辑器中的图片展示

当资产 frontmatter 包含 `image` 字段（指向本地图片路径）时：
- Markdown 预览区顶部展示图片缩略图
- 通过 Tauri `asset` protocol 将本地路径转为可渲染的 URL（`asset://localhost/{path}`）
- 点击可查看大图

### Tauri asset protocol

需要在 Tauri 配置中注册 workspace 的 `images/` 目录为 asset protocol 可访问路径，使 `<img src="asset://...">` 能加载本地图片文件。

---

## 涉及改动

| 模块 | 改动 |
|------|------|
| `apps/backend/app/agents/tools.py` | 新增 `generate_image` tool 函数 |
| `apps/backend/app/services/image_service.py`（新建） | 图片生成 API 调用封装（DALL-E 3 客户端、图片保存逻辑） |
| `apps/desktop/src/components/agent/ToolCallCard.tsx` | 检测 generate_image 结果，渲染 `<img>` |
| `apps/desktop/src/components/editor/MarkdownPreview.tsx` 或类似组件 | 资产 frontmatter `image` 字段 → 图片缩略图渲染 |
| `src-tauri/tauri.conf.json` 或 capabilities | 注册 asset protocol scope 包含 workspace images 目录 |
| `packages/shared-schema/src/index.ts` | 可选：资产类型中追加 `image?: string` 字段约定 |

---

## 风险

1. **API 成本**：DALL-E 3 每张图约 $0.04-0.12，Agent 若过度调用会产生意外费用。需在 tool prompt 中约束"仅在用户明确要求时生图"
2. **生成延迟**：图片生成通常需 5-15 秒，SSE 流中 `tool_call_start` 到 `tool_call_result` 间会有明显等待，需前端显示 loading 状态
3. **Tauri asset protocol 安全**：需限制 scope 仅允许 workspace 目录下的图片，防止路径穿越

---

## 建议落地方式

- [ ] plan：独立小型 milestone 或并入后续 milestone
- [ ] 前置条件：M19 完成（tool-calling + SSE streaming 基础设施就绪）

---

## 非目标

- 图片编辑/裁剪（不做 in-app 图片编辑器）
- 多 provider 切换 UI（初期只支持 DALL-E 3，provider 切换留给后续）
- 图片版本管理（重新生成直接覆盖，不保留历史版本）
- Stable Diffusion 本地部署集成（初期不做，降低复杂度）
