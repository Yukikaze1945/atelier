# ADR-0004：默认采用 Electron 混合架构路线

## 状态

Accepted as default — 用户于 2026-09-01 指定先以路线 C 作为默认路线；原生 GPU 预览验证仍是复审门槛。

## 背景

工作站同时需要开放的页面、主题、节点信息连接和插件市场，以及逐帧媒体、GPU 滤镜、模型隔离、项目事务和后续跨平台能力。全原生 Qt 路线有更直接的媒体/窗口整合，Electron 单体路线有更低的 UI 开发门槛，但前者不利于 Web 插件生态，后者容易把媒体和项目一致性绑进 Node/Electron。

此前规划形成路线 C：Electron/React 界面、Rust Core、C++ 媒体工作进程和独立 Python/外部插件运行时。用户现指定它作为后续规划的默认参考路线。

## 决定

默认技术架构为：

```text
Electron + React + TypeScript
项目中心 / 页面 / 市场 / 主题 / 信息连接节点图
                    │
            版本化 Host Web SDK
                    │
Rust Core Service ──┼── MCP Adapter
项目 / 契约 / 事务 / 任务 / 插件注册 / 归档
         │          │
         │          └── Python、ComfyUI、云 API、任意外部插件进程
         │
         └── C++ Media Worker（官方基础剪辑插件）
             解码 / 播放 / 混合 / 实时滤镜 / 编码 / GPU surface
```

补充规则：

1. Electron 是界面壳，不是项目事实来源，也不承担逐帧媒体处理。
2. Core 与媒体工作进程使用壳无关协议，避免公共插件 API 直接依赖 Electron IPC。
3. 第一版平台后端为 Win11；公共层遵守 ADR-0003，为 Linux/macOS 保留实现边界。
4. C++ 媒体实现属于可替换的官方基础剪辑插件，不改变 ADR-0001 的 Core/时间线边界。
5. MLT、GES、FFmpeg 组合、项目数据库精确结构和 GPU surface 桥尚未因本决定自动选定。
6. 必须先验证原生 GPU 画面能否稳定嵌入 Electron 页面区域。若验证失败或维护成本不可接受，允许把 UI 壳切换为 Qt 混合路线，Rust Core、公共契约、媒体进程和模型插件边界继续保留。

## 后果

### 正面

- 页面、主题、市场、节点图和插件 UI 使用统一 Web 技术，第三方作者门槛较低。
- 项目状态、媒体崩溃和模型依赖分别隔离，不把 Electron 变成不可替换的单体内核。
- 与 Win11 首发、Linux/macOS 后续的平台策略兼容。
- 普通页面插件、Python模型插件和原生实时滤镜不必使用同一种语言。

### 负面

- 需要维护 TypeScript、Rust、C++ 和 Python/外部进程之间的协议与构建链。
- Electron 与原生 GPU surface 的零拷贝/低拷贝预览是高风险技术接缝。
- 多进程日志、诊断、版本协商和安装包组织比单进程应用复杂。

### 中性

- “默认路线”允许被验证结果推翻，但后续研究不再把三条路线视为同等优先。
- Electron 自带 Chromium 的体积和内存开销被接受为页面插件运行一致性的代价。

## 考虑过的替代方案

### Qt Quick/QML + C++ 原生路线

保留为 GPU 预览验证失败时的后备壳。原生媒体整合更直接，但页面/主题插件形成 QML 与 Web 两套 UI 生态。

### Electron/Node 单体路线

不采用。虽然开发直接，但项目事务、模型和媒体故障会过度耦合到壳，原生扩展升级也容易拖累整个应用。

### Tauri + 系统 WebView 路线

当前不采用。体积更小，但开放页面插件更看重一致的 Chromium 目标，且 Tauri 同样不能自动解决原生 GPU 纹理嵌入。

## 参考

- `docs/planning/TECH_STACK_OPTIONS.md`
- `docs/adr/0001-core-timeline-contract-plugin-implementation.md`
- `docs/adr/0003-win11-first-cross-platform-architecture.md`

