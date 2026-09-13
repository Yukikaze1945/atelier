# 第一批可运行基座

用户于 2026-09-07 授权开始编程。已有 ADR 与完整产品规划继续有效。

## 本批交付与验证

1. **项目 Core**：Rust 独立进程；JSON-RPC 控制协议；本地项目、版本、原子事务、Undo/Redo、归档与模板。验证重开、并发旧版本拒绝、撤销后再编辑、缺失插件数据保留。
2. **桌面壳与页面插件**：Electron + React/TypeScript；项目中心、基础素材/剪辑/导出插件、节点展开、预览固定、同类型/同插件包替换、信息连线、工作流保存。验证实际 Electron 中创建项目、配置节点、替换、撤销、模板复用与重开。
3. **素材与互操作**：硬盘浏览、link/copy 导入、预览、归档恢复、基础时间线片段操作、第三方示例页面、同一 Core 的 MCP 接口。验证真实文件、中文/空格路径、插件重载、错误和断开状态。

## 开发期实现选择

- 项目格式暂为 `formatVersion: 0`。使用项目目录中的 SQLite 保存快照与事务历史，应用目录仅保存项目目录索引、插件与工作流模板。数据库布局和公共字段是开发期实现，不声称已冻结。
- 普通命令使用逐行 JSON-RPC；媒体文件经 URI 引用。时间线采用显式整数 timebase 与有理帧率，素材本身不强加时间线位置。
- 节点预览先用轻量页面结构预览/插件封面检验悬停与固定交互；实时页面实例仍保留为待决。
- 未配置的导入方式先用 `link` 作为可见的开发期默认，用户可在创建项目和节点选项中选择 `copy`；项目内更改入口暂放节点选项，正式入口仍可调整。
- 第三方页面先通过本地插件目录加载，页面容器隔离 CSS，所有公开命令平等开放。线上目录、下载更新统计与收费授权仍按完整规划后续接入。
- WeMM-Embedding-2B、ASR/TTS/视频模型、原生 GPU 预览与 GES 完整剪辑/导出尚不在此批完成；UI 必须准确报告未接入能力。浏览器兼容预览只用于验证素材操作，不能作为 GES/GPU 门槛通过的证据。

## 参考

- [Electron 自定义协议](https://www.electronjs.org/docs/latest/api/protocol/)
- [React Flow 自定义节点](https://reactflow.dev/learn/customization/custom-nodes)
- [Vite 环境要求](https://vite.dev/guide/)
- [MCP 服务端](https://modelcontextprotocol.io/docs/develop/build-server)

## 完成记录

- 已实现 Electron/React 壳、Rust Core、项目 SQLite 事务与持久化 Undo/Redo、项目中心、基础页面插件、页面/信息双层节点画布、本地插件安装、模板保存、素材导入归档与基础时间线。
- 信息端口支持 `information.resolve` 读取及 `information.publish` 显式发布；页面私有状态随项目保存、替换后归档。MCP 与 UI 使用同一 Core 和版本冲突检测。
- 17 项 Rust 行为测试、4 项 SDK 单元测试通过；真实 Electron 全流程和 MCP stdio 集成两项测试通过。TypeScript 检查、Vite/Rust 构建、Rust Clippy（warnings-as-errors）通过。
- 实际 Electron 验证覆盖：创建项目、copy 模式导入中文/空格路径 PNG、预览、加入时间线、修改时长与撤销、节点选项、悬停/固定预览、两标签替换、模板保存、本地第三方页面加载以及应用重开后的素材/片段 ID 和 Undo 恢复。
- 修复了 ESM 入口等待 Electron ready 的启动死锁，以及 Core 快照更新重置 React Flow 测量值造成的节点不可点击问题。
- C++ 媒体探针已用 MSVC 编译并运行，结果 `gesAvailable: false`；原生 GES/GPU 路径仍未通过门槛。开发版兼容预览和计划生成不代表可成片导出。
- 未实现项与使用方式以根目录 `README.md` 为准；插件接口与 MCP 配置见 `docs/development/HOST_API.md`。
- 后续启动修复：`npm start` / `npm run dev` 启动 Electron GUI 时改为 `windowsHide: false`；Core 和命令行后台任务继续隐藏。原生窗口检查确认旧实例虽位于屏幕内但不可见，修复后正常启动为 visible=true、minimized=false。新增 `tests/e2e/startup.spec.ts` 通过真实启动脚本检查 Win32 可见性，补上此前隐藏模式 UI 测试的覆盖缺口。
