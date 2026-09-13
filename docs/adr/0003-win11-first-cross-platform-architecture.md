# ADR-0003：Win11 首发，架构保留 Linux 与 macOS 实现

## 状态

Accepted — 用户于 2026-09-01 明确确认。

## 背景

AI 创作工作站第一版需要集中精力支持一个可验证的桌面环境。当前本地模型、RTX 5060 Ti、DLSS、RTX Video、D3D12 和大量 Windows 工具使 Windows 11 成为现实的首发平台。

但产品后续明确需要支持 Linux 与 macOS。如果把 Win32 路径、D3D12 handle、CUDA、注册表、Windows 命名管道或特定安装方式写入 Core 项目格式与公共插件契约，未来跨平台将不是“增加实现”，而会演变为重写 Core、迁移项目和分裂插件生态。

## 决定

第一版唯一正式支持的平台是 Windows 11；Linux 与 macOS 不属于第一版交付承诺，但从第一天开始作为架构目标保留。

采用“跨平台公共契约 + 平台后端实现”边界：

```text
项目格式 / 时间线契约 / 插件 manifest / Host API / 任务与事务
                           │
                    平台能力抽象层
          ┌────────────────┼────────────────┐
          │                │                │
    Windows 11 后端    Linux 后端（未来）   macOS 后端（未来）
    D3D12/CUDA/NVENC    Vulkan/VA-API等     Metal/VideoToolbox等
```

具体规则：

1. Core 数据模型、项目文件、JSON Schema、插件能力名和普通控制协议不得使用 Win32 专有类型。
2. 公共媒体对象只描述抽象的 surface、设备、像素格式、色彩空间、同步点和生命周期；D3D12 resource handle 是 Windows 后端的交换细节。未来允许 Vulkan、Metal、CPU/shared-memory 等实现。
3. 第一版官方媒体插件可以优先实现 D3D12、CUDA、NVDEC/NVENC、DLSS 和 RTX Video，但必须位于平台适配层或平台限定插件中。
4. 文件引用优先使用项目相对路径、规范 URI 或稳定资产 ID；不得把盘符、反斜杠、大小写不敏感或注册表当作项目格式前提。
5. 进程通信由抽象 transport 承载。Windows 可用命名管道；Linux/macOS 可用 Unix domain socket；插件公共调用语义保持一致。
6. 插件 manifest 明确声明操作系统、CPU 架构、GPU/API、驱动、运行时和可选降级条件。市场与已安装页据此显示兼容性，不要求每个插件同时支持三个系统。
7. 跨平台意味着“同一公共契约可以有不同实现”，不意味着 DLSS、CUDA 模型或某个 Windows 滤镜必须在 macOS 上存在。
8. 项目中保存平台限定效果时，其他平台必须保留其参数、引用和占位；可以报告无法预览或渲染，但不能静默删除。
9. 技术栈候选需要优先选择本身可跨平台的 UI、Core、编解码和构建基础；任何 Windows 专用依赖必须通过适配层进入。
10. 第一版至少对跨平台公共 schema、项目样例和插件 manifest 做平台无关一致性测试。何时加入 Linux/macOS 编译与运行测试，随交付计划另行决定。

## 后果

### 正面

- 第一版可以充分利用 Win11/NVIDIA 能力，不必为了暂未交付的平台做最低公分母实现。
- 未来 Linux/macOS 主要新增平台后端和插件实现，不需要重写项目契约。
- Windows 专有限定插件可以自由存在，同时项目在其他系统上仍可识别和保留其数据。
- Electron/Qt、Rust、C++媒体实现和 Python外部插件等技术候选都能按相同平台边界评估。

### 负面

- 第一版就要维护平台抽象接口、能力声明和缺失后端占位，比直接到处调用 Win32 多一些设计成本。
- 仅在 Win11 运行时，某些跨平台问题不能自动暴露，需要项目格式测试和以后真实平台验证。
- GPU surface 与编解码后端不能用单一 D3D12 类型贯穿所有公共层，会增加媒体适配代码。

### 中性

- Linux/macOS 的正式支持时间、发行格式、GPU 后端和首批兼容插件尚未决定。
- 插件市场可以包含单平台插件；兼容范围是展示与安装信息，不是拒绝开放插件。
- 当前 Electron 混合路线仍只是技术栈候选，本决定不等于批准 Electron、Rust、MLT 或 GES。

## 失败模式与控制方向

| 失败模式 | 控制方向 |
|---|---|
| 公共 API 泄漏 `HWND`、`HANDLE`、盘符等 Windows 类型 | 平台无关 schema 审查；Windows 类型只出现在后端接口 |
| 插件自称通用但直接调用 CUDA/D3D12 | manifest 声明平台与加速后端；安装页展示；运行前能力检查 |
| 项目在不同系统打开后素材路径全失效 | 资产 ID + 项目相对路径 + 重定位机制；不保存未经处理的绝对路径作为唯一引用 |
| 平台限定滤镜在其他系统打开时数据丢失 | 保留未知/缺失实现数据和占位，提供兼容报告 |
| 为未来平台过度设计，拖慢 Win11 第一版 | 只抽象已知平台接缝，不提前实现 Linux/macOS 后端 |
| “跨平台”被误解成所有模型和滤镜功能完全相同 | 区分 Core/项目兼容、宿主平台支持和单个插件兼容 |

## 考虑过的替代方案

### 完全按 Win11 编写，以后整体移植

短期最省事，但 D3D12、Win32 路径和进程模型会渗入公共契约，未来移植成本与项目迁移风险最高，不符合用户明确要求。

### 第一版同时交付 Windows、Linux 和 macOS

能最早暴露平台差异，但会同时面对 NVIDIA、AMD、Apple GPU、编解码、打包、签名和模型环境问题，显著分散第一版验证，不符合“第一版只支持 Win11”的范围。

### 只允许跨平台插件与最低公分母 GPU 功能

表面统一，但会牺牲 DLSS、RTX Video、CUDA 模型等本项目的重要能力，也违背开放插件方向。

## 参考

- `docs/planning/AI_WORKSTATION_DISCOVERY.md`
- `docs/planning/TECH_STACK_OPTIONS.md`
- `docs/adr/0001-core-timeline-contract-plugin-implementation.md`
- `docs/adr/0002-information-links-do-not-execute.md`

