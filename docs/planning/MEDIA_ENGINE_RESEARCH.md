# AI 创作工作站媒体引擎候选调研

> 日期：2026-09-01  
> 状态：已选定 GStreamer/GES + 自研媒体编排层作为首选验证路线；最终生产选型仍取决于验证结果，也不代表开始实现。

## 1. “媒体引擎”不是一种东西

在视频软件中，人们常把下面几层都叫媒体引擎，但选型时必须拆开：

| 层 | 负责什么 | 代表 |
|---|---|---|
| 非线性编辑/合成引擎 | 多轨时间线、剪切、叠加、转场、变速、播放与渲染 | MLT、GStreamer Editing Services、libopenshot、自建引擎 |
| 编解码与封装工具箱 | 读取/写入 H.264、HEVC、AV1、ProRes、音频、字幕和容器 | FFmpeg/libav、GStreamer 插件、平台编解码 API |
| 播放预览内核 | 打开单个媒体、解码、音画同步、seek、字幕与显示 | libmpv、libVLC |
| 特效/滤镜兼容标准 | 宿主把帧和参数交给第三方效果，取回结果 | OpenFX、frei0r、VST/AU、VapourSynth/AviSynth 适配 |
| 时间线交换格式 | 保存和交换剪辑决定，不负责播放和渲染 | OpenTimelineIO、AAF、FCPXML、EDL |
| GPU/平台后端 | 解码器、纹理、合成器、显示与硬件编码 | D3D12、Vulkan、Metal、NVDEC/NVENC、VideoToolbox、VA-API |

本项目真正需要选择的是第一层；其余各层很可能同时使用多个组件。

## 2. 可以承担官方剪辑插件的主要开源候选

### 2.1 MLT Framework

**定位**

MLT 是用 C 编写的多媒体框架，官方直接把它描述为非线性视频编辑器的引擎。它使用 producer、consumer、filter、transition、link 等服务组织媒体，以 playlist、multitrack 和 tractor 表达多轨合成，采用拉取帧与惰性求值。Kdenlive、Shotcut、Flowblade 等应用使用它。

**优点**

- 已经具有传统 NLE 所需的多轨、播放、转场、滤镜、变速、关键帧、预览缩放、项目序列化和无界面渲染。
- C API 与 C++ 包装层清楚，作为独立 C++ Media Worker 接入相对直接。
- 跨 Windows、Linux、macOS，核心为 LGPLv2.1。
- 目标就是编辑与播出，不需要我们从裸编解码器重新发明多轨语义。

**需要重点验证**

- 现代 10-bit/HDR、色彩管理和不同像素格式的贯通程度。
- Win11 下硬件解码、D3D12/CUDA 纹理能否避免反复回到系统内存。
- 有状态时序 AI 滤镜、随机跳转 reset、跨帧窗口和多 GPU 生命周期是否自然。
- 超大时间线、复杂嵌套、代理切换、音频延迟补偿和预览/导出一致性。

**适合我们的角色**

成熟传统剪辑能力与性能行为的参考基线。当前不再与 GES 处于同一首选优先级；即使未来采用某部分能力，也只能存在于官方基础剪辑插件内部，Core 时间线契约不能直接等于 MLT XML 或 MLT 对象。

来源：[MLT Home](https://mltframework.org/)、[MLT Framework Design](https://www.mltframework.org/docs/framework/)、[MLT Features](https://www.mltframework.org/features/)。

### 2.2 GStreamer + GStreamer Editing Services（GES）

**定位**

GStreamer 是跨平台媒体管线框架，以 element、pad、caps 协商、时钟和插件注册表组织处理。GES 在其上增加 GESTimeline、layer、track、clip、asset 与 GESPipeline，面向编辑应用提供时间线、预览和渲染。

**优点**

- 管线、时钟、协商、插件、实时流和设备接入能力成熟，适合把不同媒体模块连接起来。
- GES 当前硬件渲染设计会从已安装插件中选择 compositor、转换器、缩放器、上传/下载器，并可使用 Vulkan、GL、CUDA、D3D11/12 等后端。
- GStreamer 已有 D3D12 解码、颜色转换、缩放与 compositor 元素，对 Win11 GPU 路线很有吸引力。
- 官方提供 Windows、Linux、macOS 二进制与 Rust bindings，和我们的 Rust Core/C++媒体边界都能配合。
- caps/memory feature 的协商思路适合未来 D3D12、Vulkan、Metal 等平台 surface 后端。

**需要重点验证**

- GStreamer 本身复杂，插件选择、caps 协商、时钟、线程和故障排查的学习成本高。
- GES 的剪辑模型、重叠限制、嵌套结构和编辑行为不一定完整匹配我们自己的时间线契约。
- Windows 分发需要组织大量运行库和插件，并验证不同插件组合不会产生不可控的自动选择。
- 硬件链某个环节缺少原生元素时可能插入 download/software/upload，必须能检测而不能默默损失性能。

**适合我们的角色**

现代 GPU 媒体管线与跨平台后端的首选验证底座。采用“GES 执行适配器 + 自研媒体编排层”：Core 时间线是主数据，自研层把项目快照编译成执行计划，GES/GStreamer 负责当前适合承担的播放、同步、合成、设备和渲染管线。关键 GPU、缓存、时序 AI 或时间映射能力可以逐步由自研路径替换，公共契约不得暴露 GES/GStreamer 对象。

来源：[GES Architecture](https://gstreamer.freedesktop.org/documentation/gst-editing-services/index.html)、[GES Hardware Acceleration](https://gstreamer.freedesktop.org/documentation/gst-editing-services/hardware-acceleration.html)、[GStreamer D3D12](https://gstreamer.freedesktop.org/documentation/d3d12/index.html)、[GStreamer Downloads](https://gstreamer.freedesktop.org/download/)。

### 2.3 libopenshot

**定位**

libopenshot 是 OpenShot 提供的跨平台 C++ 视频编辑库，以 FFmpeg 读写媒体，提供多层合成、播放、动画曲线、时间映射、音频混合、效果和跨平台项目。

**优点**

- API 层级比直接使用 GStreamer/FFmpeg 高，较快获得完整编辑库的基本能力。
- 官方支持 Windows、Linux、macOS，并提供 Python/Ruby bindings。
- 已经包含读帧、时间线、动画、变速、转场、效果与音频功能。

**需要重点验证**

- 大型专业工程、精确逐帧、高轨道数量、复杂嵌套和实时预览的性能上限。
- 现代 GPU surface、D3D12/Vulkan/Metal 与 AI 时序滤镜的开放程度。
- LGPLv3/商业双许可，以及 libopenshot-audio/JUCE 等依赖带来的完整分发许可组合。
- 预览与导出是否能共享同一渲染语义，缓存和代理是否满足长期目标。

**适合我们的角色**

值得进入统一测试集，但当前证据不足以直接作为首选。它更可能帮助我们快速验证剪辑插件 API，也可能适合较轻量的替代剪辑插件。

来源：[libopenshot](https://www.openshot.org/libopenshot/)、[libopenshot C++ API](https://www.openshot.org/static/files/libopenshot/)。

### 2.4 FFmpeg 等底层组件 + 自建时间线/渲染图

**定位**

自己实现片段求值、时间映射、轨道合成、缓存、预览调度、音画同步和渲染图；FFmpeg 只负责 demux、decode、encode、mux、重采样和部分滤镜，GPU 后端直接接 D3D12/Vulkan/Metal/NVIDIA SDK。

**优点**

- 可以完全围绕我们的 Core 时间线契约、AI生成片段、有状态滤镜、插件 surface 和多平台后端设计。
- 最容易保证公共模型不受 MLT/GES 私有语义限制。
- 能精确控制零拷贝、缓存、代理、预览质量和最终渲染路径。

**代价**

- FFmpeg 不是 NLE 引擎。随机 seek、VFR、反向播放、音画同步、逐帧精确、变速音频、转场、嵌套时间线、代理、缓存、取消与预览/导出一致性都要自己实现。
- 工作量与长期维护风险最高，最容易做出“能导出几个片段”但无法支撑专业剪辑的大坑。
- 编解码器、GPU API、驱动和跨平台差异会直接落到团队身上。

**适合我们的角色**

长期自由度最高的路线，也是 DaVinci/Premiere 类商用软件更接近的形态。当前不选择“一开始完全自研”，而采用 GES + 自研编排的渐进路线：先复用成熟媒体数据平面，再根据验证逐步替换关键调度和 GPU 路径。

来源：[FFmpeg About](https://ffmpeg.org/about.html)、[libavformat](https://ffmpeg.org/libavformat.html)、[libavfilter](https://ffmpeg.org/libavfilter.html)、[FFmpeg License](https://ffmpeg.org/doxygen/trunk/md_LICENSE.html)。

## 3. 常被叫作媒体引擎，但不能单独承担剪辑内核的组件

### FFmpeg/libav

几乎一定会参与编解码、封装、探测和导出，但没有项目事务、Undo、媒体管理、交互时间线和完整实时预览调度。它是底盘零件，不是整车。

### libmpv

mpv 官方推荐通过 libmpv 把它嵌入其他应用作为视频/音频播放后端。它非常适合素材查看器、单文件源监视器、快速格式兼容验证，也有硬件解码、字幕、seek 和渲染 API；但它不是多轨 NLE 时间线与最终合成引擎。若预览使用 libmpv、导出使用另一套管线，还要防止两边效果和色彩不一致。[libmpv embedding](https://mpv.io/manual/master/#embedding-into-other-programs-libmpv)

### libVLC

libVLC 是 VLC 的核心播放引擎，跨平台、格式和协议支持广、运行时插件多，也适合媒体浏览或播放型插件；但它同样不是完整非线性编辑引擎。[libVLC](https://www.videolan.org/vlc/libvlc.html)

### OpenTimelineIO

OTIO 保存 clips、timing、tracks、transitions、markers 和 metadata，并外部引用媒体。它适合导入导出和与其他编辑软件交换剪辑决定，不解码、不播放、不渲染音视频。[OpenTimelineIO](https://opentimelineio.readthedocs.io/en/latest/index.html)

### OpenFX

OpenFX 是宿主和 2D 图像效果插件之间的 C API，宿主给插件输入 clips、参数和 suites，再取回输出图像。它可以成为我们的兼容滤镜层，但不负责时间线、音频、编解码和项目管理。[OpenFX Image Effect API](https://openfx.readthedocs.io/en/main/Reference/ofxImageEffectAPI.html)

## 4. Premiere Pro 使用什么媒体引擎

Adobe 公开使用的名字是 **Mercury Playback Engine（MPE）**。

从 Adobe 当前公开说明可以确认：

- MPE GPU Acceleration 负责或加速一系列效果、图像处理、色彩转换、缩放、时间线播放、scrubbing 与预览渲染。
- Premiere 与 Adobe Media Encoder 都使用 Mercury 路线完成相关处理和导出工作。
- 硬件 H.264/H.265 解码和编码会根据 NVIDIA、Intel、AMD 或 Apple silicon 选择不同硬件能力。
- Mercury Transmit 是外接监视器和第三方 I/O 输出方向的配套组件，不等于时间线引擎本身。

需要注意：Mercury Playback Engine 是 Adobe 的私有内部引擎，不是可供我们链接的库；它也不等于整个 Premiere。Premiere 在它上面仍有私有的项目、素材、编辑命令、时间线和 UI，旁边还有 Media Encoder、插件和音频子系统。

更准确的类比是：**MPE 接近我们规划中的 C++ Media Worker/视频渲染管线，而不是 Rust Core 或整个官方剪辑插件。**

来源：[Adobe Mercury Playback Engine](https://helpx.adobe.com/premiere/desktop/get-started/download-and-install/mercury-playback-engine-gpu-accelerated-in-premiere.html)、[Premiere hardware encoding/decoding](https://helpx.adobe.com/premiere/desktop/get-started/technical-requirements/hardware-accelerated-decoding-and-encoding.html)。

## 5. DaVinci Resolve 使用什么媒体引擎

Blackmagic 没有公开一个与 “Mercury Playback Engine” 完全对应、统一命名的 **DaVinci Media Engine**，也没有公开说明其剪辑内核建立在 MLT、GES 或 FFmpeg 之上。能从官方资料确认的是一组自研、深度整合的专用处理系统：

| 子系统 | 公开职责 |
|---|---|
| Cut/Edit 的私有剪辑与图像处理管线 | 时间线、剪辑、播放、效果、代理与交付；公开资料未给出统一引擎名称 |
| Fusion | 节点式 2D/3D 合成、VFX、运动图形，32-bit float 色彩管线 |
| DaVinci Color/Resolve Color Management | 32-bit 图像处理、YRGB/色彩管理、HDR 和节点调色 |
| Fairlight Audio Core | 低延迟、多核/多线程、可扩展的音频处理与混音引擎 |
| DaVinci AI Neural Engine | 人脸、对象、重构图、Speed Warp、Super Scale 等 AI 功能 |
| Resolve FX / OpenFX host | GPU/CPU 效果和第三方 OpenFX 插件 |

因此“达芬奇用什么媒体引擎”的严谨回答是：**核心是 Blackmagic 自研的私有多引擎架构；音频引擎有公开名称 Fairlight Audio Core，AI 有 DaVinci Neural Engine，Fusion 是独立合成系统，但主视频剪辑/播放/渲染内核没有公开一个统一商品名。**

它给我们的架构启发不是去复制某个库，而是：共享同一个工程和时间关系，同时允许剪辑、合成、调色、音频与 AI 使用不同专用引擎。这与“Core 契约 + 可替换剪辑插件 + 其他页面/能力插件”的方向相容。

来源：[DaVinci Resolve Overview](https://www.blackmagicdesign.com/products/davinciresolve?web=1)、[Fairlight Audio Core](https://www.blackmagicdesign.com/products/davinciresolve/fairlight)、[DaVinci Color](https://www.blackmagicdesign.com/products/davinciresolve/color)、[Fusion](https://www.blackmagicdesign.com/products/fusion/visualeffects)。

## 6. 当前候选位置与首选验证结论

| 候选 | 时间线成熟度 | 现代 GPU/跨平台潜力 | 自由度 | 工程成本 | 当前研究位置 |
|---|---:|---:|---:|---:|---|
| MLT | 高 | 中，需实测 | 中 | 中 | 传统 NLE 参考基线 |
| GStreamer + GES | 中高 | 高 | 高 | 中高 | 首选执行底座验证路线 |
| libopenshot | 中 | 待验证 | 中 | 中低 | 轻量/快速验证候选 |
| GES + 自研编排/关键路径 | 由两者共同承担 | 高，目标可替换 | 很高 | 高 | 当前首选组合 |
| FFmpeg等 + 完全自建 | 取决于我们 | 最高 | 最高 | 最高 | 失败后的完整替代路线 |

用户已经确认优先尝试 **GES + 自研媒体编排层**，MLT 降为传统 NLE 参考，不再要求先做同等规模的 MLT 集成。下一步验证应让 GES 适配器、自研关键路径样件和必要参考工具面对同一组测试素材与操作，比较：

1. 精确 seek、逐帧与快速 scrubbing。
2. 多轨、嵌套、变速、转场、字幕和音频同步。
3. H.264/HEVC/AV1、10-bit、HDR、VFR 与代理媒体。
4. D3D12 硬解码、GPU compositor 和 Electron 原生预览桥。
5. 一个颜色帧滤镜、一个有状态时序滤镜、一个离线 AI 任务的接入方式。
6. 预览与最终导出一致性、缓存失效、取消和崩溃恢复。
7. Windows 分发体积、许可证与未来 Linux/macOS 后端。

这组验证决定 GES 能承担多少，而不是决定 Core 是否改用 GES 数据模型。无论结果如何，Core 时间线、插件产物与事务仍是主数据。详见 `docs/adr/0006-prioritize-ges-plus-owned-media-orchestration.md`。
