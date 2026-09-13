# 开发期 Host API 与插件接入

当前控制协议为 JSON-RPC 2.0（单行 JSON / stdio），`protocolVersion: 1`，项目格式为开发期版本 0。所有修改由 Rust Core 保存，UI 与 MCP 使用相同方法。大媒体通过文件 URI / Asset ID 引用，不放进 JSON 消息。

## Core 方法

| 方法 | 参数 | 行为 |
|---|---|---|
| `system.info` | `{}` | 版本及未接入能力状态 |
| `project.list` | `{}` | 本机索引中的项目；离线项目保留列表项 |
| `project.create` | `name, parentDirectory, projectTemplate?, templateId?, workspace?, timelineSettings?` | 创建新目录，拒绝覆盖；blank 不创建时间线 |
| `system.videoPresets` | `{}` | 返回已实现的视频尺寸/有理帧率预设 |
| `project.open` | `directory` | 验证已有 project.sqlite 并重新定位 |
| `project.get` | `projectId` | 工程、revision、工作区、资产、时间线、归档和 Undo 状态 |
| `project.command` | `projectId, expectedRevision, command` | 一次原子修改，进入 Undo 历史 |
| `project.undo / project.redo` | `projectId, expectedRevision` | 撤销/重做；revision 继续递增 |
| `asset.import` | `projectId, expectedRevision, mode, files: [{path,metadata?}]` | link/copy 导入；批次源文件先检查；重复有效源 URI 跳过 |
| `asset.search` | `projectId, query, mode?, includeArchived?` | text 查名称/元数据；semantic 明确报未接入 |
| `asset.inspect` | `projectId, expectedRevision, assetId` | 原生探测真实时长/媒体流并原子保存到素材元数据，可撤销 |
| `information.resolve` | `projectId, nodeId` | 读取输入绑定，不执行任何任务 |
| `workspace.replacementReport` | `projectId, nodeId, pluginId, pageId` | 查看哪些连接/选项能复用 |
| `template.save / template.list` | save: `projectId, name` | 保存独立工作区模板 / 列出模板 |
| `plugin.inspect / plugin.install` | `directory` | 验证 / 注册本地插件目录 |
| `plugin.list` | `{}` | 已安装贡献、启用状态与来源 |
| `plugin.enable` | `pluginId, enabled` | 改变启用状态，工程数据保持原样 |
| `plugin.uninstall` | `pluginId` | 取消第三方插件注册；源文件保留 |
| `media.plan` | `projectId` | 返回 version=1 的冻结计划、解析后的媒体 URI 与实时执行器能力 |
| `media.capabilities` | `{}` | 调用原生进程探测 GES、编码预设与 GPU 工厂 |
| `media.inspect` | `uri` | 用 GStreamer Discoverer 读取媒体时长、流、尺寸、帧率 |
| `media.export` | `projectId, expectedRevision, outputPath, profile` | 提交异步 GES 导出；profile 为 mp4-h264 或 webm-vp8，拒绝覆盖 |
| `media.jobs` | `projectId?` | 最近 100 项任务状态、进度、错误、日志与输出路径 |
| `media.cancel` | `jobId` | 请求取消，保留部分成片 |

接口 JSON 类型见 `packages/sdk/src/index.ts`。调用修改前读取当前 revision；旧 revision 返回 `REVISION_CONFLICT`，调用方需重新读取状态和判断是否重试，不能覆盖他人的编辑。

## 项目命令

每个命令均带 `type` 字段：

- `project.rename`: `name`
- `workspace.add`: `pluginId, pageId`
- `workspace.remove`: `nodeId`，保存到归档；连接记录保留。
- `workspace.replace`: `nodeId, pluginId, pageId`，保留位置/身份，旧状态归档；跨插件同名选项不视为语义兼容。
- `workspace.configure`: `nodeId, position?, expanded?, config?`，选项按 manifest 校验。
- `workspace.reorder`: `nodeIds`，必须完整、无重复地列出页面节点。
- `workspace.state`: `nodeId, state`，保存插件页面自己的状态，替换/移除后仍可找回。
- `information.connect`: `source, sourcePort, target, targetPort, dataType`；端口方向/类型必须匹配，同一输入只能有一条有效绑定。
- `information.disconnect`: `linkId`
- `information.publish`: `nodeId, portId, value`，向声明的输出端口显式发布 JSON 值或对象引用。
- `asset.archive / asset.restore`: `assetId`；不删除原文件，不移除引用它的时间线片段。
- `asset.metadata`: `assetId, metadata`
- `timeline.create`: 创建默认时间线。
- `timeline.settings`: `settings: {width, height, frameRate: {numerator, denominator}}`。同样可在 `timeline.create` 中提供 settings，或在 project.create 中提供 timelineSettings。
- `timeline.add`: `assetId, trackId, startTicks?, durationTicks?`
- 同轨放入、移动、扩展片段默认采用覆盖剪辑：裁切已有片段的冲突区间，保留左右余段和正确源入点，被覆盖区间归档。整次操作一次 Undo；不同轨道互不裁切。
- `timeline.resolveOverlaps`: 显式整理旧版保存的同轨重叠，按片段数组后项优先覆盖前项；切掉的区间归档，可撤销。打开工程不会自动运行。
- `timeline.restoreSource`: `clipId`，显式恢复视频/音频的完整源时长和零入点，保留片段身份、位置、轨道，可撤销。
- `timeline.update`: `clipId, startTicks?, inTicks?, durationTicks?, trackId?`
- `timeline.split`: `clipId, atTicks`，必须落在片段内部。
- `timeline.remove`: `clipId`，片段进入归档。
- `archive.restore`: `archiveId`

时间线具有显式 `timebase`。默认 240,000 ticks/秒，帧率可配置并约分为正有理数；29.97 使用 30000/1001。更改输出 fps 不改变 timebase 或片段 ticks，避免改变剪辑速度。该字段属于时间线，未放在时间线上的普通素材没有人为起点。复杂变速和 VFR 编辑映射仍待实现。

## 原生媒体和 GPU 路径

Core 在独立线程启动一次性 GES 工作进程；项目快照不随后续编辑变化。任务状态为 queued/running/cancelling/cancelled/completed/failed/interrupted，记录存在应用 catalog.sqlite 中，临时结果仅在 EOS 成功后发布。跨进程文件锁用于识别意外失去所有者的任务。提交、查询、取消均开放给 MCP。

任务可携带 `pipelineAudit`：当前后端生成的可选诊断数据，记录实际视频工厂、已协商的 pad caps 和是否观察到系统内存合成。它不是跨后端时间线契约，调用方不应依赖其中的 GStreamer 私有名称来驱动项目编辑。空记录或未观察到系统内存不构成“已验证零拷贝”的结论。

默认 mp4-h264 明确选择 x264；硬件工厂存在不等于 NVENC 编码会话可用。同轨重叠和未实现的 clip.extensions 会报错，防止静默改变输出。

桌面媒体高速路径另提供 `media.gpu.start({projectId,assetId})`、`media.gpu.stop({})`，测试可用 `testPattern:true`。先调用桌面桥 `prepareGpuPreview()`，页面提供 `native-gpu-preview` canvas；`onGpuStatus()` 收到逐帧呈现或错误信息。

GStreamer appsink 通过分配协商要求可共享 D3D11 纹理；不接受共享池或出现系统内存时显式失败。生产进程将 NT HANDLE 复制到 Electron 进程，Electron sharedTexture 把同一纹理交给 renderer，WebGPU 从 VideoFrame 导入外部纹理后呈现；GPU 完成和所有引用释放后才让生产器复用该帧。此路径不使用原始帧 JSON、CPU 映射或桥接纹理复制。

当前这条验证路径处理源视频、无音频，尚未替代完整 GES 多轨合成预览；不能将其测试结果称为整个编辑器的端到端零拷贝。

## 信息端口与页面上下文

`information.resolve` 返回每个输入端口的 `status`、来源和 `value`。状态包括 `available`、`unconnected`、`source-unavailable`、`no-value`。插件缺失或版本不符不删除连接。

- `workstation.assets@1` 默认读取当前未归档素材的 ID/revision 引用。
- `workstation.timeline@1` 默认读取当前时间线 ID 和项目版本。
- 插件显式发布的端口值优先于默认项目视图，便于提供素材子集、选择范围或自有信息。
- 其他自定义类型需先通过 `information.publish` 发布；连接/查询不会隐式执行插件。
- 大对象由 Asset ID、文件 URI 或后续媒体句柄引用，插件不应把整段视频放进端口 JSON。

## 本地页面插件

示例 `examples/plugins/reference-board` 提供可直接运行的 `plugin.json` 与 `index.html`。一个包可有多个页面，页面有稳定 ID、类型、端口、renderer 与选项。当前支持 boolean、select、number、text 选项。

页面容器使用独立文档，避免 CSS 覆盖宿主。它通过 `postMessage` 调用公开 API：

```js
parent.postMessage({
  type: 'workstation.request',
  id: 'read-project-1',
  method: 'project.get',
  params: { projectId }
}, '*');
```

宿主回送 `workstation.response`（相同 id 与 result/error）。页面加载和工程改变时收到 `workstation.context`，内容包含 `sdkVersion`、`nodeId`、当前 `project` 和解析后的 `information`。主动发送 `context.get` 可请求一次上下文推送。监听消息时检查 `event.source === parent`。

所有已安装插件可调用全部公开 API，不按认证等级裁剪。类型校验、项目版本和命名空间用于兼容与恢复。第三方本地安装使用一次统一提醒；本批不实现 Python/原生滤镜进程执行或细粒度权限。

## MCP 配置

先运行 `npm run build`。在第三方 Agent 的 MCP 设置中加入：

```json
{
  "mcpServers": {
    "creative-workstation": {
      "command": "node",
      "args": ["D:/coding/AI/scripts/mcp.mjs"]
    }
  }
}
```

若桌面使用自定义 `WORKSTATION_DATA_DIR`，在 MCP 的 env 中设置同一路径。当前入口提供 project_list/get/command/undo、asset_search/import、plugins_list、information_resolve 和 media_plan。桌面通过轮询接收外部 Core 进程的版本变化。

典型流程：列项目 → 获取项目版本 → 搜索素材 → 读取页面输入绑定 → 显式添加到时间线或发布结果。未接入 Embedding 模型时，semantic 搜索返回工具错误 `CAPABILITY_UNAVAILABLE`。

MCP 服务器只写协议到 stdout，诊断写 stderr。它自身不会循环运行工作流；流程顺序和重试由调用方 Agent 负责。
