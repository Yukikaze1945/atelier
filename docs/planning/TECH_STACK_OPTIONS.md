# AI 创作工作站技术栈候选与决策门槛

> 日期：2026-09-01  
> 状态：路线 C 已被用户选为默认技术架构；具体组件与实现仍处于规划和验证阶段，不代表开始写代码。  
> 平台决定：第一版唯一正式支持 Windows 11；Linux 与 macOS 是明确的后续目标，因此公共契约、项目格式和插件协议不得固化 Win11。详见 `docs/adr/0003-win11-first-cross-platform-architecture.md`。

## 1. 先从产品要求倒推，而不是从框架喜好出发

本项目同时需要四种普通桌面应用很少同时具备的能力：

1. 页面、页面顺序、主题、节点信息连接和插件市场要容易扩展。
2. 剪辑预览、逐帧定位、实时滤镜、硬件编解码和导出不能被 Web UI 性能绑死。
3. Python/CUDA 模型依赖经常冲突，插件必须能带自己的运行环境、进程和模型文件。
4. Core 时间线契约、项目事务、Undo/Redo、版本、归档和 MCP 自动化需要成为稳定公共层。

因此不建议找一种语言包办全部工作。更合理的原则是：

```text
界面自由度        交给 Web UI
项目一致性        交给独立 Core
每帧媒体与 GPU    交给原生媒体实现
AI 模型兼容       交给隔离的 Python/外部服务
```

这不是把一个功能拆成四份，而是让每种插件只接触自己需要的层。普通页面插件不需要懂 C++；TTS/ASR 插件通常只需 Python 和宿主协议；实时滤镜插件才需要原生 GPU 接口。

## 2. 三套完整路线

| 路线 | 主要组成 | 最大优点 | 主要代价 | 当前判断 |
|---|---|---|---|---|
| A. Qt 原生路线 | Qt Quick/QML + C++20；插件页面可嵌 Qt WebEngine；Python 模型独立进程 | 原生预览、D3D/NVIDIA 和窗口合成最直接 | 页面/换肤作者门槛较高；QML、C++、Web 页面形成两套 UI 生态；Qt/Qt WebEngine 分发许可需要专门核查 | 性能保底方案 |
| B. Electron 单体路线 | Electron + React/TypeScript + Node 原生扩展 + Python | 页面、主题、市场、节点图开发最快 | 容易把项目状态、媒体任务和插件都塞进 Electron；原生扩展崩溃和 ABI 升级会拖累整壳；实时媒体路径不自然 | 不建议 |
| C. Electron 混合路线 | Electron/React 界面 + Rust Core 服务 + C++ 媒体实现 + Python/外部插件进程 | 保留 Web 插件自由，同时把项目一致性、媒体和模型故障隔开 | 进程协议和多语言构建更复杂；原生 GPU 预览嵌入必须先通过技术验证 | 用户已选默认路线 |

### 为什么没有把 Tauri 放在首选

Tauri 使用 Rust 后端和系统 WebView，安装体积小，也能捆绑任意语言编写的 sidecar；这些都是真优点。但当前产品不是轻量工具，而是会常驻视频缓存、模型和数 GB 显存的创作工作站。相比少占一些内存，插件页面在不同电脑上获得一致的 Chromium、调试行为和前端能力更重要。

Tauri 依赖操作系统 WebView；Electron 自带确定版本的 Chromium。对于开放的页面插件和换肤插件，后者更容易给作者一个可复现的运行目标。Tauri 也没有自动解决“原生 D3D 纹理怎样进入 Web 页面”这个难题。因此它保留为以后可重新评估的壳，不作为当前第一推荐。

参考：[Tauri Architecture](https://v2.tauri.app/concept/architecture/)、[Tauri sidecar](https://v2.tauri.app/develop/sidecar/)、[Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model)。

## 3. 默认路线 C 的分层

```text
Electron + React/TypeScript
项目中心 / 页面条 / 插件页 / 市场 / 节点信息连接 / 主题
                    │
        版本化 Host Web SDK（不暴露 Electron 私有 IPC）
                    │
Rust Core Service ──┼── MCP Adapter
项目 / 事务 / Undo / 版本 / 归档 / 任务 / 插件注册 / 能力调用
         │          │
         │          └── Python、ComfyUI、云 API 等插件进程
         │
         └── 官方基础剪辑插件的 C++ Media Worker
             解码 / 播放 / 合成 / 实时滤镜 / 编码 / 导出 / GPU surface
```

这里 Electron 只负责“人看到和操作什么”，不是工程真相来源，也不负责逐帧视频处理。Electron 官方的多进程模型和 Utility Process 本身支持把易崩、CPU 密集或不可信服务放到独立进程；本项目会进一步把 Core 和媒体工作进程做成壳无关服务，而不是 Node 子模块。

### 3.1 界面壳：Electron + React + TypeScript

建议用途：项目中心、页面装配条、插件市场、已安装管理、工作流模板、LLM/字幕/TTS 等页面、信息连接节点图、设置和主题系统。

选择原因：

- 页面插件可以用标准 Web 技术实现，不强迫作者学习 QML。
- React/TypeScript 很适合大量状态面板、可组合页面和 schema 生成表单。
- 换肤可以有不同贡献形态：普通主题插件贡献颜色、字号、间距、图标和组件变量；整壳皮肤可以替换声明过的布局插槽。二者不是权限等级，整壳皮肤也只需遵循统一安装提醒与激活冲突规则。
- 每个插件页面使用独立渲染上下文或隔离容器，CSS 和快捷键不会无意覆盖其他页面；这是避免 UI 冲突的技术边界，不是限制插件能做什么。
- 时间线画布不应给每个片段创建大量 DOM 节点；官方剪辑页应使用 Canvas/WebGL/WebGPU 类绘制层。具体选择需要用大工程滚动、缩放和拖拽测试后再定。

不建议把项目数据长期放在 React store、localStorage 或 Electron 主进程内存。前端状态只保存当前选中项、面板开合等临时 UI 状态，项目事实来自 Core。

### 3.2 项目 Core：Rust

建议职责：项目对象、公共时间线契约、事务、Undo/Redo、版本、软删除/归档、任务状态、插件注册、能力发现、类型连接、资源状态和统一命令总线。

选择原因：

- 这些对象会被 UI、插件、MCP Agent 和后台任务同时修改，Rust 对并发和内存错误的约束比把它们长期堆在 Node 或 C++ 中更合适。
- Core 不需要每帧运行，Rust 的主要价值是可靠性、类型和异步任务，而不是追求表面上的“更快”。
- Core 独立后，未来即使把 Electron 换成 Qt、Web 或其他壳，项目格式和插件控制协议仍可保留。

Rust 不负责直接加载第三方 Python 包，也不要求所有插件用 Rust。它只是稳定宿主。

### 3.3 媒体实现：C++20 原生工作进程

建议职责：硬件解码、逐帧访问、音视频同步、代理媒体、实时预览、滤镜栈、混音、硬件编码和最终导出。它属于预装的官方基础剪辑插件，而不是不可替换的 Core。

选择原因：

- FFmpeg、MLT、GStreamer、Direct3D、NVIDIA SDK、OpenFX 等主要接口都天然面向 C/C++。
- DLSS、RTX Video、实时插帧和后续原生效果要直接处理 D3D11/D3D12/CUDA 资源；把这段能力放在 Python 或 JavaScript 中会不断绕回原生桥。
- 把 C++ 限定在媒体工作进程，即使解码器、驱动或第三方滤镜崩溃，也不应破坏项目 Core 的事务数据。

FFmpeg 适合作为编解码、封装和滤镜工具箱，但不是完整剪辑时间线。官方基础剪辑插件优先验证 **GStreamer Editing Services（GES）+ 自研媒体编排层**：Core 时间线保持唯一主数据，自研层把项目快照编译为执行计划，GES/GStreamer 先承担适合的 timeline、track、播放、同步与渲染管线，关键 GPU、缓存和时序处理可以逐步由自研路径接管。MLT 降为传统 NLE 参考基线；任何候选的私有对象都不能泄漏进 Core 时间线契约。

参考：[FFmpeg libavformat](https://ffmpeg.org/libavformat.html)、[MLT Documentation](https://www.mltframework.org/docs/)、[GStreamer Editing Services](https://gstreamer.freedesktop.org/documentation/gst-editing-services/index.html)。FFmpeg 分发配置还必须单独审核 LGPL/GPL 组合：[FFmpeg License](https://ffmpeg.org/doxygen/trunk/md_LICENSE.html)。

### 3.4 AI/服务插件：Python 或任意外部进程

Python 是 MOSS、Qwen ASR、FireRedAudio、IndexTTS、GPT-SoVITS、RIFE、SeedVR2 等本地模型最现实的胶水层，但不能把所有插件装进一个全局 Python 环境。

建议默认支持：

- 每个插件自己的 Python 版本、依赖锁和环境；优先用 `uv` 管理普通环境和 lockfile。
- CUDA、PyTorch 或特殊编译依赖无法由统一方式管理时，插件可以声明 Conda 环境、内置运行时、Docker/WSL、ComfyUI 服务或用户提供的外部命令。
- 插件 manifest 声明启动方式、能力、模型位置、显存预估、释放命令和健康检查；宿主只管理生命周期，不 import 插件代码。
- 云端模型也是同一种“能力实现插件”，只是执行位置不同，不需要在 Core 中另造一套对象。

`uv` 官方文档确认项目可拥有独立虚拟环境和精确 lockfile，但模型插件仍需保留其他运行方式，避免为了工具统一而牺牲开放性：[uv projects](https://docs.astral.sh/uv/concepts/projects/)。

## 4. 插件协议不能只有一种速度

同一插件包可以同时贡献页面、后台能力和原生滤镜，但不同数据不应走同一条传输路径。

### 控制路径：易调试、跨语言

- 命令、对象引用、进度、错误、参数和普通产物元数据：版本化 JSON-RPC。
- 输入输出、manifest、设置表单和公共对象：JSON Schema 2020-12。
- Electron 页面通过 Host Web SDK 调用；SDK 内部再转发给 Core，插件不能把 Electron IPC 当公开 API。
- MCP 是同一公共命令总线的 Agent 适配层，不是 Core 内部总线。这样手动 UI 和 Agent 不会出现两套业务逻辑。

MCP 当前标准传输使用 JSON-RPC，并提供 stdio 与 Streamable HTTP；官方已有 TypeScript、Python、Rust 等 SDK。项目可以优先提供本地 stdio，并在确有远程控制需求时再开放 HTTP。[MCP SDKs](https://modelcontextprotocol.io/docs/sdk)、[MCP Transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)。

### 媒体高速路径：不传 JSON，不复制整段视频

- 文件级离线任务传素材句柄、时间范围和输出位置。
- 大块音频/CPU 帧使用共享内存或内存映射文件。
- Windows 实时 GPU 帧使用 D3D12 shared resource handle + shared fence 等原生同步机制；插件声明接受的像素格式、色彩空间、尺寸和设备。
- 极低延迟滤镜可以声明同进程原生模式，不限定认证状态，也不经过细粒度权限申请；安装提醒说明其可能影响宿主稳定性。

Direct3D 12 官方支持为 resource、heap 和 fence 创建跨进程共享 handle，但 Electron 的 JavaScript 渲染层并不能自动导入任意 D3D 纹理。因此“原生 GPU 预览怎样进入页面区域”是壳选择的硬门槛，而不是已经解决的问题。[Microsoft CreateSharedHandle](https://learn.microsoft.com/en-us/windows/win32/api/d3d12/nf-d3d12-id3d12device-createsharedhandle)。

## 5. 项目存储建议

建议项目是一个目录包，而不是单个巨大 JSON 或把媒体塞进数据库：

```text
Project/
  manifest.json          项目版本、固定插件版本、页面组合、入口信息
  project.sqlite         对象、事务、版本、连接、任务、来源与归档索引
  media/                 选择内嵌时保存的原始或生成媒体
  proxies/               可重建代理
  cache/                 可清理缓存
  archive/               被移除但仍可找回的文件型产物
  plugin-data/           按插件 ID 隔离的扩展数据
```

SQLite 适合保存原子事务和可查询关系；WAL 模式允许读写并行，但复制项目、异常退出和关闭项目时必须正确处理 `-wal`/`-shm` 与 checkpoint，不能只复制主数据库文件。大视频和模型权重不进入 SQLite。OTIO 适合做剪辑交换适配器，不适合作为本项目全部工程格式，因为它主要保存 editorial cut 信息并外部引用媒体，不包含本项目的插件装配、AI 来源、任务、归档等完整语义。

参考：[SQLite WAL](https://sqlite.org/wal.html)、[SQLite atomic commit](https://www.sqlite.org/atomiccommit.html)、[OpenTimelineIO](https://opentimelineio.readthedocs.io/en/latest/index.html)。

## 6. 正式选栈前必须完成的五个验证

这些是技术决策实验，不是删减完整产品范围的 MVP：

1. **Electron 原生预览门槛**：在 Windows 上把硬件解码后的 GPU 帧显示到可移动、缩放、全屏的页面区域；验证逐帧、快速 seek、HiDPI、遮罩/字幕叠加和无 CPU readback。失败则把首选壳切到 Qt Quick/QML 混合路线。
2. **GES + 自研边界验证**：用多轨、变速、转场、字幕、代理、硬件编解码和自定义 D3D 滤镜验证 Core 执行计划到 GES 的映射；MLT 只保留必要的传统 NLE 行为/性能参考，不做同等规模实现。
3. **开放插件组合**：一个测试插件同时提供页面、主题、后台 Python 能力和实时滤镜；卸载后项目保留数据与连接占位，重装后恢复。
4. **模型依赖与显存**：同时安装两个依赖冲突的 PyTorch 插件，验证环境互不污染、显存上报、停止/释放和 Core 不退出。
5. **工程恢复**：在事务提交、媒体生成、插件崩溃和系统强制终止时分别中断，验证重开项目、Undo/Redo、归档和半成品标记。

## 6.1 Win11 首发不等于 Windows-only 架构

第一版可以直接使用 D3D12、CUDA、NVDEC/NVENC、DLSS 和 RTX Video，但这些属于 Win11 媒体后端或平台限定插件。Core 只识别抽象媒体 surface、设备能力、资产引用和同步语义，不把 `HWND`、Win32 `HANDLE`、盘符或注册表写进公共对象。

为后续 Linux/macOS 保留的准备包括：

- UI 壳、Rust Core、项目 schema、JSON-RPC 和普通插件页面保持跨平台可构建。
- 媒体与 GPU 层使用后端接口：第一版实现 D3D12/CUDA；未来可以增加 Vulkan、Metal、VA-API、VideoToolbox 等实现。
- 本地 IPC 不把 Windows 命名管道写成协议本身；Windows、Linux/macOS 可以分别选择不同 transport。
- 插件 manifest 声明 `os`、`arch`、GPU/API、驱动与降级能力；市场显示兼容范围，但允许单平台插件。
- 项目媒体优先保存资产 ID、相对路径或规范 URI；绝对 Windows 路径不能成为唯一引用。
- 其他平台缺少某个滤镜或模型时保留完整参数和占位，不静默删除项目数据。

这只要求现在切对边界，不要求第一版提前实现或测试完整 Linux/macOS 媒体后端。

## 7. 当前可先记住的结论

- 默认路线是 **Electron/React 界面 + Rust Core + C++ 媒体工作进程 + 独立 Python/外部插件运行时**。
- 路线已经确认，但 Electron 仍必须通过原生 GPU 预览验证；失败时按 ADR-0004 复审界面壳，不自动推翻其余分层。
- FFmpeg 可视为高可信基础工具候选；GES + 自研媒体编排层是首选验证路线，但 GES 尚未通过生产选型门槛，MLT 已降为参考基线。
- JSON/JSON Schema 只走控制与元数据；大媒体走句柄、共享内存或 GPU surface。
- MCP 只是 Agent 入口适配器，不能取代插件内部协议、项目事务或媒体高速路径。
- 四种语言并非要求每个作者都会四种；它们是四种插件形态各自的最佳工具。

## 8. 仍需用户逐项确认

平台范围已经确认：第一版唯一正式支持 Windows 11，但架构必须为后续 Linux/macOS 保留实现边界。

插件权限策略已经确认：不设置细粒度宿主权限；普通主题和整壳皮肤是贡献类型差异，不是权限等级。

1. 先验证官方基础剪辑插件的 GES + 自研媒体编排组合，再根据结果决定 GES 承担范围和需自研替换的关键路径；详见 `docs/adr/0006-prioritize-ges-plus-owned-media-orchestration.md` 与 `docs/planning/MEDIA_ENGINE_RESEARCH.md`。
2. 再逐项确定项目存储、控制协议和 GPU surface 桥的具体实现。
