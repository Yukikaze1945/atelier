# DeepSeek Harness 插件机制研究

> 日期：2026-08-31
>
> 用途：为 AI 创作工作站的插件架构提供对照，不代表采用其技术栈或完整设计。

## 1. 官方架构的核心思想

DeepSeek Harness（DSH）建立在 Cordis 插件框架之上。官方描述是“几乎所有部分都是插件”：模型适配器、工具注册表、会话日志和 Agent Loop 都通过插件组合。

插件主要向一个共享 Context 贡献：

- 服务：稳定的 `ctx.<key>` 能力入口。
- 类型化事件：观察、串行、并行、瀑布包装或短路决策。
- 可撤销 effect：注册与插件生命周期绑定，卸载时自动清理。

插件通过 `inject` 声明所需服务。缺少依赖时不会靠人工启动顺序硬拼，而是等待依赖可用。

官方来源：

- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-primer.md

## 2. Profile、Bundle 与插件树

一个运行中的 DSH 是启动时组合出的插件树：

- Profile：一种命名组合，包含有序 Bundle、外部插件和用户补丁。
- Bundle：携带一层配置补丁的分发包，可以插入或替换插件配置行。
- Overlay/Patch：在基础 Bundle 之上继续覆盖，支持用户定制。

这让 Web、Headless、SDK、ACP 等不同产品表面可以共享基础能力，但装配不同插件组合。

对工作站的启发：

- “项目页面条”可以借鉴 Profile：每个项目保存启用页面、插件与排列顺序。
- 官方预设、用户预设和项目覆盖可以分层，但必须明确优先级。
- 不应允许普通第三方 Bundle 任意覆盖安全、工程和事务核心配置。

官方来源：

- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/README.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/boot/app-boot/README.md

## 3. 能力接口与具体实现分离

DSH 把可替换能力分成三个角色：

1. Service Definition：稳定接口。
2. Service Provider：接口的一种具体实现。
3. Consumer：使用该接口的工具、页面或其他服务。

此前提到的 Provider 就来自这个概念。对用户而言，可改称“能力实现”或直接显示具体插件/模型名称。

映射示例：

| 稳定能力 | 具体实现 | 使用者 |
|---|---|---|
| 语音转字幕 | Whisper、本地 SenseVoice、云端 ASR | 字幕页面、Agent、右键工具 |
| 视频生成 | 本地 ComfyUI、云端视频模型 | 生成页面、Agent |
| 视频超分 | SeedVR2、其他模型 | 滤镜面板、交付页面 |

这一分离能让调用方依赖“能做什么”，而不是绑定某个插件名称。

官方来源：

- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md#capability-seams
- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-a-package.md

## 4. DSH 不是只有一种插件

官方扩展 Cookbook 列出的扩展形态包括：

| 插件形态 | 机制 |
|---|---|
| 工具 | 注册到工具表，带输入和输出 schema |
| Hook / Policy | 在执行前后或 Agent 生命周期事件上观察、包装、批准或拒绝 |
| UI | 监听持久事件流，并通过 Agent 公共入口发送输入 |
| Web 业务节点 | 注册有 key 的 Conversation Node 与 renderer |
| 外部协议驱动 | 把 JSON-RPC、stdio 等对端适配到 Agent 服务 |
| 模型适配器 | 在统一模型接口下注册具体模型实现 |
| 后台任务 | 注册 Job 服务并提供查询、停止等控制 |
| MCP | 每个服务器由插件发现工具并注册进工具表 |
| Skill | 注册上下文与工具，调用时注入内容 |

对工作站的启发：插件包可以同时声明多个 Contribution，但宿主应为页面、滤镜、命令、处理器、Agent 工具和后台任务定义不同契约。

官方来源：

- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/extension-cookbook.md

## 5. UI 插件怎样接入

DSH 的设置卡示例把插件分成 Host 与 Browser 两半：

- Host 半注册带命名空间的设置 schema、校验和变更处理。
- Browser 半向宿主预定义的 keyed slot 注册自己的卡片。
- Host 与 Browser 使用相同 namespace 关联。
- 页面只渲染当前部署真正提供的 namespace。
- Client bundle 对跨插件值导入设置纯度检查，跨插件协作应通过 Cordis 服务。

值得借鉴：

- 插件不直接遍历并修改整个 UI，而是进入命名的插槽。
- 插槽拥有唯一 key、上下文条件、排序和生命周期。
- 配置 schema 与 UI 卡分离；没有 Host 能力时，不显示空壳 UI。
- 插件之间不应靠导入彼此 UI 内部代码协作。

仍需改进之处：DSH 当前示例中卡片按注册顺序排列，keyed entry 本身没有独立 order；我们的页面条和面板需要明确、可预测、可由项目覆盖的排序规则。

官方来源：

- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-a-settings-card.md

## 6. 持久事件与可重建状态

DSH 把 SessionEvent 日志作为模型上下文、回放、恢复、分叉、遥测和 UI 投影的来源。需要跨重启存在的事实写入持久事件；运行中的拦截与观察使用实时事件。

对工作站的可能启发：

- 时间轴和工程当前状态仍可使用适合编辑器的权威模型。
- 同时保留工程操作、插件任务、产物来源、归档与恢复的持久事件或事务记录。
- UI 页面从稳定工程模型和事件投影读取状态，而不是自己维护不可重建的私有副本。

这只是类比，尚未决定采用完整事件溯源。

官方来源：

- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md#session-log

## 7. 安装、权限与安全问题

DSH 的外部插件通常作为 npm 包安装进某个 Profile，Bundle 通过 manifest 指向配置补丁。官方发布指南特别提醒：允许 Git 依赖执行构建脚本等于允许其在沙箱之外运行本机代码，应只信任来源并固定提交；预构建 npm 包或 tarball可减少安装时构建权限，但不能自动证明运行时代码安全。

DSH 的官方 SAFETY 文件进一步说明：项目可以执行第三方插件和模型生成的命令，并接触网络、进程、凭据和文件；沙箱、审批和权限只能降低风险，不能保证隔离。

对工作站的结论：

- 不能把第三方插件默认当成与宿主同等可信。
- 安装前需要展示来源、签名/哈希、扩展点、配置覆盖、文件/网络/GPU/外部进程权限。
- 第三方插件不能覆盖安全策略、工程存储、事务、Undo/Redo 或宿主升级机制。
- 页面类插件优先放在受限 UI 容器；模型与后台服务优先放到独立进程；实时滤镜则需单独设计高性能 ABI 与崩溃隔离策略。

官方来源：

- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/SAFETY.md

## 8. 曾提出但未采用的三层信任模型

状态：2026-08-31 用户明确不采用“保护时间轴、默认限制第三方插件自由”的方向。以下内容保留为研究历史，不是当前方案。

### Layer 0：受保护宿主内核

- 工程文件与迁移
- 时间轴权威状态
- 事务、Undo/Redo 与归档
- 权限、插件注册表和冲突处理
- 崩溃恢复、任务监督和渲染提交

这一层原计划阻止第三方插件改动部分核心能力；用户已明确要求时间轴向插件完整开放，因此不能按此作为功能限制。

### Layer 1：官方/受信任模块

- 本体页面和可替换官方功能
- 官方媒体后端、字幕基础、导出模块
- 可使用更高性能的进程内接口，但仍通过公开契约注册

### Layer 2：第三方扩展

- 页面、面板、命令、滤镜、生成器、模型、Agent 工具、导入导出器
- 只进入声明的扩展点
- 按类型选择 Web 沙箱、独立进程、受限 GPU 接口或兼容桥
- 安装、升级和首次高风险调用均受权限与冲突策略约束

### 项目组合层

它不是新的信任级别，而是每个项目保存：

- 启用哪些页面与插件
- 页面顺序
- 默认能力实现
- 插件配置引用
- 缺失插件占位符与恢复信息

## 9. 借鉴与不照搬

### 借鉴

- 稳定服务键与声明式依赖。
- 类型化事件和明确的分发模式。
- 所有注册都可撤销，卸载后没有残留监听器。
- Profile/Bundle 的组合思想。
- 能力定义、具体实现、消费者分离。
- Keyed UI slots 与命名空间。
- 插件配置 schema 和自动校验。
- 持久事实与实时事件分开。

### 不照搬

- 不采用“没有受保护 Core”的极端做法。
- 不让未受信第三方插件默认进入主进程。
- 不允许普通插件用配置补丁覆盖安全和工程不变量。
- 不用通用 Agent Tool 接口承载实时逐帧滤镜；实时媒体需要专门契约。
- 不把页面导航、自动工作流和能力实现混成同一种插件对象。

## 10. 用户确认后的修正方向

- 插件可完整操作时间轴和工程，不把时间轴当成禁止扩展的保护区。
- 统一时间轴 API、事务、事件与格式校验仍然需要存在，但目的变为兼容性、Undo/Redo、升级稳定和避免工程损坏，而不是审查插件能做什么。
- 平台主要对“认证插件”承担审核与兼容承诺。
- 未认证插件保持开放安装，通过醒目标识、免责声明和安装信息让用户自行承担风险。
- DeepSeek Harness 最值得借鉴的是插件树组合、稳定服务键、声明式依赖、可撤销 effect、Profile 组合与 keyed UI slots，而不是默认安全隔离。
