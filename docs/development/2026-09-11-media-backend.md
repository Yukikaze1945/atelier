# GES 后端与源视频 GPU 桥接实现记录

按用户“先做好后端”的要求，在既有项目/插件基座上补齐媒体执行与视频设置；未进行前端美术重做。

## 已落地

- 官方 GStreamer 1.28.6 runtime + devel，安装到 `.deps/gstreamer`；安装包 SHA256 为 `059251444d1267b486eba390b18d25fed87e10315e72f757ec6c7e912fa746b5`，从官方 sha256sum 校验。
- Rust 提供帧率/尺寸预设、创建时配置、时间线修改、Undo 与持久化。输出帧率是正有理数，改设置不改时间基准或片段实际时间。
- C++ GES 工作进程把 Core 执行计划映射为轨道/图层/片段，读取真实素材、编码 MP4 或 WebM；显式拒绝未实现的重叠/效果语义。
- Core 管理独立媒体任务、冻结项目版本、进度、错误、取消与中断记录；完成后以不覆盖目标的方式发布文件。MCP 使用同一任务 API。
- D3D11 解码/转换 → 可共享纹理池 → 跨进程 NT HANDLE → Electron sharedTexture → WebGPU 外部纹理采样。只有确认 GPU 完成且引用全部释放，生产器才释放当前样本。

## 实测与修复

- 真实 GES 成片重新通过 GStreamer Discoverer 检查了 640×360、30000/1001 fps 与片段时长。
- 输出文件已存在时拒绝覆盖；取消不产生正式目标；已完成文件保持不变。
- NVENC 虽有工厂，但本机初始化编码会话失败。默认 H.264 因此明确使用 x264，未把软件编码冒充 GPU 编码。
- GPU 测试图案和真实 H.264 源视频均已连续呈现；帧信息报告 D3D11Memory、CPU 回读 0、桥接 GPU 复制 0。自动解码限定 D3D11，避免选择不匹配的 CUDA/D3D12 内存路径。
- 画面设置修改与撤销、孤立任务恢复及旧项目/插件/节点/窗口启动纳入回归。
- 验证结果：20 项 Rust 行为测试、4 项 SDK 测试、5 项 Electron/MCP/GES/GPU/启动集成测试通过；TypeScript、构建和 Rust Clippy 通过。
- 新增双视频轨执行器审计：本机 GES 1.28.6 实际选择 `gessmartmixer0-compositor`（工厂 `compositor`），sink_0、sink_1 和 src 都协商为系统内存 NV12。运行时诊断随任务的 `pipelineAudit` 持久保存，导出页可展开查看。
- 最新在线硬件合成选择文档与当前固定的 1.28 分支实现存在差异；不能仅提高已安装 `d3d11compositor` 的优先级便宣称当前所有 GES 辅助环节已保持 GPU 内存。后续需对源转换、翻转、空隙生成和混合分别接管并复测。

## 仍未完成

- GES 多轨混合、字幕/效果合成到 Electron 画面的全链路 GPU 零拷贝。
- NVENC 会话验证、编码器参数面板与硬件编码策略。
- 原生时间线预览的音画同步、连续 seek、VFR/反向/嵌套/变速与颜色一致性。
- 同轨重叠和插件效果的 GES 映射。目前以明确错误代替静默降级。

普通编辑预览仍使用原有兼容路径；GPU 按钮是独立的源视频实验入口。源视频桥接成功不等于整个时间线合成已通过生产门槛。

## 实现参考

- [GStreamer 官方 Windows 安装说明](https://gstreamer.freedesktop.org/download/)
- [GESPipeline](https://gstreamer.freedesktop.org/documentation/gst-editing-services/gespipeline.html)
- [Electron sharedTexture](https://www.electronjs.org/docs/latest/api/shared-texture)
- [GStreamer D3D11 内存接口](https://raw.githubusercontent.com/GStreamer/gstreamer/main/subprojects/gst-plugins-bad/gst-libs/gst/d3d11/gstd3d11memory.h)

以上为接口参考；零拷贝桥接结论以本机 `tests/e2e/gpu.spec.ts` 的实际结果为限。
