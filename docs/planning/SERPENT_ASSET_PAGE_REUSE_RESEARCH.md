# Serpent 素材页代码复用调研

> 日期：2026-09-01  
> 审查对象：[dolag233/Serpent](https://github.com/dolag233/Serpent) commit `084a55d2190e52ded553119802907385bec26466`（0.1.5）  
> 状态：用户已确认只复刻功能与交互、独立重新实现并适配本项目，不直接照抄或移植 Serpent 代码。未修改或接入产品代码。

## 1. 为什么值得参考

Serpent 是 MIT 许可的 Electron + React + TypeScript 数字资产管理软件，与本项目默认 UI 技术路线高度接近。项目已经覆盖：

- 图片、视频、音频、文本、3D、PDF、RAW 和图片序列等多种资产；
- 平铺、瀑布流、justified 等高密度浏览与虚拟化窗口；
- 文件夹、合集、智能合集、标签、评分、喜欢、描述和结构化元数据；
- 关键词搜索、字段限定、过滤、排序与 FTS5/SQLite；
- 缩略图、代理视频、悬停预览、音频波形、3D 查看和 EXR 等专业格式；
- 导入、链接目录、回收站、恢复、拖放、跨平台路径与媒体任务调度；
- 插件、脚本、MCP 和 AI 分析。

来源：[Serpent README](https://github.com/dolag233/Serpent)、[产品简报](https://github.com/dolag233/Serpent/blob/main/docs/product-brief.md)、[package.json](https://github.com/dolag233/Serpent/blob/main/package.json)。

MIT 许可证允许使用、复制、修改、合并、发布、分发、再许可和销售，但复制或实质性使用时必须保留原版权和许可声明。[Serpent LICENSE](https://github.com/dolag233/Serpent/blob/main/LICENSE)

## 2. 不建议整仓嵌入的原因

Serpent 是一个完整独立应用，不是可直接安装的素材浏览组件。当前源码同时拥有自己的：

- Electron main/preload/renderer/worker 分层；
- better-sqlite3 资源库、迁移、文件操作和历史；
- 资产领域模型和资源库生命周期；
- 插件、权限、脚本与 MCP 平台；
- FFmpeg/OIIO/Sharp 媒体任务和缓存；
- 更新、同步、外部资源库和 AI 队列。

这些职责与我们的 Rust Core、官方素材页插件、GES/GStreamer 媒体层和统一 MCP/插件系统直接重叠。整仓作为子应用或把 Serpent 数据库当第二主数据，会造成资产 ID、事务、缓存、插件、媒体任务和归档各有两套真相。

源码也不是已经拆好的组件库。在本次审查版本中，`src/renderer/App.tsx` 约 12,546 行，`src/worker/library-service.ts` 约 41,893 行，`styles.css` 约 10,921 行；许多成熟行为已经实现，但选择性移植需要先切断与 Serpent library API、Worker 和全局样式的耦合。

Serpent 本身还采用受控/可信插件和显式权限模型，与本项目“不建立细粒度插件权限”的已确认决策不同，不能直接继承其插件平台。

## 3. 三种参考方式与最终选择

### A. 独立复刻功能与交互（已选择）

优先研究和重新实现：

- `asset-grid-layout`、`canvas-asset-layout`、`virtual-browse-layout/canvas` 等布局算法；
- 卡片尺寸、滚动锚点、重排恢复、框选、键盘选择和拖放交互；
- AssetCard、悬停预览、徽标、Inspector 的交互模式；
- 搜索表达式、过滤/排序建模和智能合集思路；
- 缩略图/代理任务优先级、并发和内存预算策略；
- 图片序列、音频波形和不同查看器的模块划分。

实现直接从我们的 `AssetSummary`、`AssetQuery`、`ArtifactRef`、`PreviewHandle` 和 Host 操作接口出发；素材页不打开 Serpent SQLite，也不启动 Serpent 自己的插件/MCP/AI Worker。Serpent 源码用于理解功能边界、边缘情况和交互效果，不作为组件依赖。

优点是最终代码和对象模型完全适合本项目，不需要长期同步上游内部结构，也不会引入第二主数据。缺点是实现成本高于复制现有文件，成熟细节必须通过规格和测试逐项还原。

### B. 与上游合作抽出独立浏览组件

推动或协助 Serpent 将虚拟化资产画布、卡片和查看器抽成无数据库依赖的独立包，然后本项目通过适配器提供数据。

长期维护最干净，但依赖上游意愿、接口方向和发布时间，不应成为项目必需前提。

### C. 把完整 Serpent 作为子应用/外部进程

接入最快，但会形成独立资源库、独立插件系统和割裂的拖放/选择体验。只适合作为外部资源库导入适配器，不推荐作为开箱素材页。

## 4. 已确认的素材页定位

默认素材页复刻 Serpent 的高级资产管理能力，但服务于当前项目而不是另建一个孤立 DAM；页面结构同时参考 DaVinci Resolve Media 页，分离硬盘来源浏览器与项目素材库：

```text
官方素材页插件（React）
├─ 文件夹 / 合集 / 智能合集
├─ 虚拟化资产画布
├─ 搜索 / 过滤 / 排序
├─ Inspector / 元数据 / 来源
├─ 缩略图 / 悬停 / 深度预览
└─ 添加到时间线 / 发送给插件 / 返回生成结果
                │
           Host Asset API
                │
Rust Core 的资产、产物、引用、归档和事务
                │
GES/GStreamer 或格式插件提供预览派生物
```

Serpent 的 UI 视觉不必原样复制。我们的素材页需要与 DaVinci 风格的深色专业工作区、页面条、时间线选择和插件信息连接保持一致。

## 5. 来源与独立实现边界

- 默认不复制 Serpent 源文件、大段代码或资源；实现规格从本项目对象和验收行为出发。
- 如果未来确实复制任何实质性代码，必须单独记录原仓库、commit、原路径和改动，并按 MIT 保留版权与许可文本。
- 不复制 Serpent 名称、Logo、品牌素材或假装为其官方衍生产品。
- Serpent 的第三方组件按各自许可证审计；复制 MIT 源码并不自动授予 FFmpeg、OIIO、字体或其他资源的不同许可。
- 独立重写仍在工程调研记录中注明功能参考来源，避免把参考研究误写成原创调研结论。

## 6. 采用前的验证

1. 从 Host Asset API 规格直接实现资产画布，证明不需要 Serpent library API 或第二数据库。
2. 10 万级资产下验证滚动、重排、搜索、缩略图加载和内存上限。
3. 视频悬停预览切换到 GES/GStreamer 派生物后不重复启动 FFmpeg 代理管线。
4. 从素材卡拖到时间线时保留资产 ID、版本和范围，不只传文件路径。
5. 素材被插件替换、归档或重新生成后，画布与 Inspector 通过 Core 事件正确刷新。
6. 核对移植文件的 MIT 通知及其直接依赖许可。
