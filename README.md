# Atelier · AI 创作工作站

本地优先、由插件组合页面的 AI 创作工作站。当前已有可运行基座、GES 导出后端与实验性 D3D11 共享纹理预览，首发验证平台为 Windows 11。

## 启动

需要 Node.js 22.19+、Rust 稳定工具链和 Visual Studio C++ Build Tools。当前机器的依赖和调试构建已经准备好，可直接运行：

```powershell
npm start
```

首次安装或换一台机器：

```powershell
npm ci
npm run setup:media   # Windows：安装官方 GStreamer 1.28.6 开发运行库到 .deps/gstreamer
npm run build:media
npm run build
npm start
```

开发时运行 `npm run dev`，启动 Rust Core、Vite 与 Electron。仅打开 Vite 网页不会替代桌面应用。

## 已可使用

- **项目中心**：创建、打开、搜索与网格/列表浏览本地项目；单击选中，双击、Enter 或底部“打开”进入；支持保存位置、项目模板和页面组合。
- **独立 Rust Core**：SQLite 事务、版本冲突检测、自动保存，以及跨重启保留的 Undo/Redo。
- **页面插件**：预装素材、剪辑、导出页；可添加、移除、替换、禁用，项目数据保留。
- **节点画布**：ComfyUI 风格展开选项；左上按钮悬停预览、点击固定、再次点击关闭；右键替换包含“同类型节点 / 同插件包节点”。预览当前为轻量结构示意。
- **信息连接**：手动拉线、唯一匹配时自动连接，双击连接线断开；独立于页面顺序，不执行任务。自定义端口支持显式发布与读取数据。
- **工作流模板**：保存页面、顺序、选项和信息连接，创建新项目时复制；不复制素材、时间线内容和插件运行状态。
- **素材页**：硬盘目录浏览、拖拽/选择文件导入、link/copy 模式、名称/元数据筛选、图片/浏览器支持的音视频预览、归档恢复。
- **基础剪辑**：素材添加到轨道、片段水平拖动、起点/入点/时长调整、播放头分割、移除与撤销；Canvas 时间线、兼容预览和源/时间线双监看器。上方按钮可开合媒体池与检查器。
- **视频设置**：新建项目、剪辑页“时间线视频设置”和导出页“视频设置”可选 720p、1080p、竖屏、4K 或自定义尺寸/有理帧率；修改设置可撤销，不改变片段实际时间。
- **GES 导出**：MP4/H.264+AAC（明确使用 CPU 编码）和 WebM/VP8+Vorbis；独立 C++ 进程执行项目快照，任务进度/取消/错误和中断记录由 Core 保存。拒绝覆盖现有目标文件。
- **GPU 验证**：剪辑页“GPU 验证”对选中视频源使用 D3D11 解码、共享 NT 纹理句柄、Electron sharedTexture 和 WebGPU 呈现；无视频选中时使用 GPU 测试图案。源视频链路已验证，尚不代替完整 GES 多轨合成预览。
- **显存状态**：右下角显示 NVIDIA 设备的实际显存占用；监测接口不可用时显示“—”。
- **本地第三方页面**：加载插件目录、CSS 独立的页面容器、同一公开 Host API 和项目上下文。包含可安装的参考素材板示例。
- **MCP**：Agent 可以列出和读取项目、搜索/导入素材、读取信息绑定、显式编辑和撤销，以及提交、查看、取消 GES 导出任务，复用同一 Core。

## 目前的界限

完整产品规划仍保存在 `docs/planning/`，并未缩成上述清单。以下能力还没有完成：

- 完整 GES 多轨合成到桌面画面的 GPU 零拷贝管道；目前验证的是源视频链路。转场、效果扩展和同一轨道内重叠片段的原生导出尚未实现，遇到这些情况明确报错。
- NVENC 编码会话验证与选择。本机 NVENC 工厂可被发现，但实际编码会话曾失败，默认 MP4 预设使用 x264，避免按“插件存在”推断“硬件编码可用”。
- 模型运行时、WeMM-Embedding-2B 等语义搜索、视频生成、ASR/OCR/TTS、超分、插帧与 AI 音频处理。
- 在线市场下载、更新检查、GitHub Stars 同步、下载统计与付费授权。当前市场展示本机插件注册表。
- 任意主题/整壳皮肤加载、滤镜运行时、模型显存释放与模型任务取消/进度。插件 manifest 预留的贡献字段不代表这些能力已实现。
- 完整专业剪辑功能、原生预览/导出一致性，以及十万素材级性能验证。素材网格当前按页展示，目录浏览一次最多显示 2,000 项。
- 插件多版本并存与升级迁移界面。项目固定插件版本，不匹配时显示占位；可重新安装相符版本或显式替换节点。

当前项目格式版本为 **0（开发期）**，正式格式与迁移规则尚未冻结。普通时间线预览仍是 Chromium 兼容路径；实验性 GPU 源视频路径有独立验证，不将其结果扩展到全部 GES 合成场景。

## 数据位置与恢复

- 新建项目在选择的位置下创建同名目录，拒绝覆盖已有目录。
- `project.sqlite` 保存项目快照和撤销历史；复制导入的文件放在 `media/<Asset ID>/`。
- Windows 应用目录默认为 `%APPDATA%/creative-workstation`，保存项目/插件/模板索引及媒体任务记录；`media-jobs/` 保存冻结计划、取消标志与工作进程日志。
- Electron 与 MCP 默认共用该目录。可用 `WORKSTATION_DATA_DIR` 指定独立测试目录。
- 归档素材/页面/片段保留数据；Undo 不删除已复制文件，以便 Redo。取消插件注册保留插件源目录。
- 导出先写目标目录内的独立 `.partial` 文件，只在成功 EOS 后原子发布成片；取消/失败保留部分文件。Core 异常退出的任务通过所有者文件锁检测为 interrupted，不永久显示为运行中。
- 移动项目后，用项目中心“打开项目”重新选择其文件夹。退出应用及相关 MCP 进程后，备份整个项目目录，保留数据库可能存在的 WAL 文件。
- 第三方本地插件目前注册的是源目录，安装后需保留该目录。所有插件都可以使用全部公开能力，安装提醒只出现一次；页面容器用于样式和故障隔离，不是权限分级。

## 试用第三方插件

1. 在项目中心打开“插件市场”，选择“从本地安装插件”。
2. 选择 `examples/plugins/reference-board`，查看说明并继续安装。
3. 打开项目，展开“页面节点”；在素材节点右键“替换节点”。
4. “同类型节点”中选择“参考素材板”。替换后可读取同一份项目素材，原配置可撤销恢复。

## 检查

```powershell
npm run test         # Rust 项目行为与 SDK 单元测试
npm run typecheck    # TypeScript
npm run build       # 前端与 Rust 构建
npm run test:e2e     # 真实 Electron 和 MCP 集成测试
```

端到端测试在临时目录中创建工程，不使用实际项目；截图和 GPU 帧信息保存在 `test-results/` / 测试报告中。原生能力检测：

```powershell
npm run build:media
npm run probe:media
```

能力检测调用实际媒体工作进程，报告 GES、编码预设和已发现的工厂。`gpuZeroCopy.validated=false` 特指完整 GES 合成链仍待验证；源视频桥接的实际验证由 `tests/e2e/gpu.spec.ts` 完成。

GStreamer 为官方校验过的 1.28.6 开发运行库，可用 `WORKSTATION_GSTREAMER_ROOT` 指定其他兼容安装。`WORKSTATION_MEDIA_WORKER` 可指定替代执行器。运行库中部分编码插件具有 GPL 许可，依赖二进制不纳入源码目录分发；最终打包配置与项目许可证仍需另行确定。

## 代码组织

```text
src/                       Electron 中的 React 工作区与基础页面
electron/                  桌面壳、文件访问和 Core 进程桥
packages/sdk/              壳无关 Host SDK 与公共类型
crates/workstation-core/   项目、事务、资产、插件/信息连接契约
plugins/official-base/     预装基础插件 manifest
examples/plugins/         可实际安装的第三方页面示例
native/                   C++ GES 执行器、D3D11 纹理生产器与依赖探针
scripts/mcp.mjs            Agent 的 MCP stdio 入口
docs/development/          本批实现与 Host API 说明
docs/planning/             完整产品规划
```

公共 API 和 MCP 配置示例见 [Host API](docs/development/HOST_API.md)，开发期选择见 [第一批实现记录](docs/development/2026-09-07-foundation.md)。本项目基于 [Apache-2.0 License](LICENSE) 协议开源。
