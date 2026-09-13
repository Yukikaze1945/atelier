# 闭源收费插件兼容性调研

> 日期：2026-09-01  
> 状态：确认技术与许可证上可行；主项目许可证、支付和授权方案尚未由用户选择。本文不是法律意见。

## 1. 结论

本项目可以同时保持开源基座并允许第三方发布闭源收费插件。开放插件能力与插件是否公开源代码是两件事；稳定的公开协议反而能让开源、免费闭源和收费闭源实现共存。

GStreamer 本身使用 LGPL，官方许可说明明确以“应用可以选择自己的许可证”为目标，也讨论并允许 proprietary plugins；`GstPluginDesc` 的许可证字段直接支持 `Proprietary`。但主程序采用的许可证和捆绑的每个媒体组件仍需分别审计。

来源：[GStreamer Licensing FAQ](https://gstreamer.freedesktop.org/documentation/frequently-asked-questions/licensing.html)、[GstPluginDesc](https://gstreamer.freedesktop.org/documentation/gstreamer/gstplugin.html)、[GStreamer Legal Issues](https://gstreamer.freedesktop.org/documentation/frequently-asked-questions/legal.html)。

## 2. 什么能真正闭源

| 插件形态 | 闭源强度 | 说明 |
|---|---|---|
| C++/Rust 原生动态库或独立 Worker | 高 | 可以只分发二进制和资源，通过版本化 Host API/IPC 接入 |
| 云端 Provider | 高 | 本地只有连接器，主要模型和商业逻辑留在服务端 |
| Python 插件 | 低到中 | 可以打包或混淆，但很难阻止有能力的用户读取逻辑 |
| Electron 中运行的 JavaScript/React 页面 | 低 | 可以压缩和混淆，但最终代码会到用户机器，不能承诺真正保密 |
| 混合插件 | 推荐 | 页面和薄适配层可检查，核心算法放在闭源原生 Worker 或云端 |

宿主不应承诺 DRM 不可破解。商业作者可以自行提供账号、许可证文件、离线激活或订阅验证；Host 只需要提供稳定生命周期、设备信息的最小标准字段、凭据存储适配和授权状态展示接口。是否由官方市场代收款仍是独立商业决策。

## 3. 主项目许可证的三个候选

### A. MPL-2.0 Core + Apache-2.0 插件 SDK（当前推荐研究项）

- MPL 是文件级 copyleft：修改 MPL 文件并分发时需要公开这些文件，但独立新文件和更大的专有组合可以保持闭源。
- Apache-2.0 SDK 对商业作者简单，并包含明确专利授权条款。
- 适合“基座改进尽量回流，同时允许闭源插件”的目标。

来源：[Mozilla MPL 2.0 FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/)、[Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0.html)。

### B. 全部 Apache-2.0

- 最简单、商业兼容性强，插件和衍生发行都容易。
- 代价是第三方可以闭源修改并重新发行整个基座，不必把改进回馈项目。

### C. GPL + 明确插件例外

- Core 的 copyleft 最强，同时通过例外允许闭源插件。
- 许可证说明、第三方组合和作者理解成本最高；例外文本必须经过正式法律审核。
- GStreamer 官方 FAQ 也把 GPL exception 列为允许非 GPL 插件的做法之一。

在用户明确选择前，不把任何一个方案写成最终许可证。

## 4. GStreamer/GES 分发注意点

- 优先动态链接 GStreamer/GES，不把 LGPL 库静态焊进不可替换的单体二进制。
- 分发许可证文本、版权声明和对应版本的源码获取说明，并允许用户替换 LGPL 库；具体合规流程需发布前复核。
- 对 `base/good/bad/ugly/libav` 及其外部库逐项记录有效许可证，不能只写“GStreamer 是 LGPL”就认为所有插件包都相同。
- 编解码器还可能涉及地区专利和硬件 SDK 条款，许可证审计与技术能力发现分开维护。
- 第三方商业插件直接使用 GStreamer 时，由作者对其二进制和依赖承担合规责任；市场清单显示作者声明的许可证，但平台认证不能替作者提供法律担保。

## 5. 市场和包格式需要预留

现有 dsh-market 式公开 Registry 可以继续使用，但闭源收费插件不能强制要求公开 GitHub 源码仓库。市场条目需要区分：

- `sourceRepo`：可选，开源仓库地址；
- `homepage`：产品介绍页；
- `purchaseUrl`：购买入口；
- `download/updateFeed`：作者控制的签名包或更新清单；
- `licenseModel`：free/open-source/paid/perpetual/subscription；
- `publisher` 与可选签名：用于确认作者身份和更新来源，不是细粒度权限系统。

首期可以让作者自行收款和授权，市场只负责发现、安装、更新和已购状态跳转；是否建设官方结算以后单独决定。

## 6. 仍需用户确认

1. 主项目许可证倾向 MPL-2.0、Apache-2.0，还是 GPL + 插件例外。
2. 市场首期只跳转作者购买页，还是长期规划官方结算与分成。
3. Host 是否提供通用许可证状态接口，还是完全由插件自己的页面处理激活。

