import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Layers3,
  Undo2,
  Redo2,
  Check,
  Workflow,
  ChevronUp,
  ChevronDown,
  Cpu,
  FolderOpen,
  X,
  Unplug,
} from "lucide-react";
import type {
  PluginRecord,
  ProjectView,
  ResourceStatus,
} from "../packages/sdk/src";
import { desktop, host } from "./host";
import { ProjectContext } from "./context";
import { ProjectCenter } from "./components/ProjectCenter";
import { WorkspaceGraph } from "./components/WorkspaceGraph";
import { MediaPage } from "./components/MediaPage";
import { EditPage } from "./components/EditPage";
import { WorkspaceMenu } from "./components/WorkspaceMenu";
import { PageCustomization } from "./components/PageCustomization";
import { ExportPage } from "./components/ExportPage";
import { PluginPage } from "./components/PluginPage";
import {
  Button,
  Empty,
  Glyph,
  IconButton,
  PageBoundary,
} from "./components/ui";

export default function App() {
  const [customizing, setCustomizing] = useState(false);
  const [project, setProject] = useState<ProjectView>();
  const current = useRef<ProjectView | undefined>(undefined);
  const [plugins, setPlugins] = useState<PluginRecord[]>([]);
  const [active, setActive] = useState("");
  const [graph, setGraph] = useState(false);
  const [toast, setToast] = useState("");
  const [resource, setResource] = useState<ResourceStatus>();
  const [busy, setBusy] = useState(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const notify = useCallback((message: string) => setToast(message), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 6500);
    return () => clearTimeout(t);
  }, [toast]);
  const accept = useCallback((next: ProjectView) => {
    if (
      current.current?.id === next.id &&
      current.current.revision >= next.revision
    )
      return;
    current.current = next;
    setProject(next);
  }, []);
  const loadPlugins = useCallback(async () => {
    setPlugins(await host.plugins.list());
  }, []);
  const refresh = useCallback(async () => {
    const id = current.current?.id;
    if (id) {
      const next = await host.projects.get(id);
      if (current.current?.id === id) accept(next);
    }
  }, [accept]);
  useEffect(() => {
    loadPlugins().catch((e) => notify(e.message));
    const off = desktop?.onChanged(() => {
      void loadPlugins().catch((e) => notify(e.message));
    });
    return () => off?.();
  }, [loadPlugins, notify]);
  useEffect(() => {
    let live = true;
    const sample = () =>
      host
        .request<ResourceStatus>("system.resources")
        .then((s) => {
          if (live) setResource(s);
        })
        .catch(() => {});
    void sample();
    const timer = setInterval(sample, 6000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (!project) return;
    const timer = setInterval(
      () => refresh().catch((e) => notify(e.message)),
      2500,
    );
    return () => clearInterval(timer);
  }, [project?.id, refresh, notify]);
  useEffect(() => {
    if (project && !project.workspace.pages.some((n) => n.id === active))
      setActive(project.workspace.pages[0]?.id || "");
  }, [project?.workspace.pages, active]);
  const execute = useCallback(
    (method: string, params: Record<string, unknown>) => {
      const requestedProject = current.current?.id;
      const task = queue.current
        .catch(() => {})
        .then(async () => {
          const p = current.current;
          if (!p || p.id !== requestedProject) return;
          setBusy((n) => n + 1);
          try {
            const next = await host.request<ProjectView>(method, {
              ...params,
              projectId: p.id,
              expectedRevision: p.revision,
            });
            if (current.current?.id === p.id) accept(next);
            return next;
          } catch (error) {
            notify(String(error));
            await refresh().catch(() => {});
            return undefined;
          } finally {
            setBusy((n) => n - 1);
          }
        });
      queue.current = task;
      return task;
    },
    [accept, notify, refresh],
  );
  const command = useCallback(
    (command: Record<string, unknown>) =>
      execute("project.command", { command }),
    [execute],
  );
  const openPage = useCallback((id: string) => {
    setActive(id);
    setGraph(false);
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input,textarea,select,[contenteditable="true"]')) return;
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === "z" &&
        current.current
      ) {
        e.preventDefault();
        void execute(e.shiftKey ? "project.redo" : "project.undo", {});
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        notify("工程已自动保存。");
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [execute, notify]);
  function open(project: ProjectView) {
    accept(project);
    setActive(project.workspace.pages[0]?.id || "");
    setGraph(!project.workspace.pages.length);
  }
  const node = project?.workspace.pages.find((n) => n.id === active);
  const plugin = node
    ? plugins.find(
        (p) =>
          p.manifest.id === node.pluginId &&
          p.enabled &&
          p.manifest.version === node.pluginVersion,
      )
    : undefined;
  let page;
  if (!node)
    page = (
      <Empty
        title="组装这个项目的工作区"
        action={
          <Button onClick={() => setGraph(true)}>
            <PlusIcon />
            添加页面
          </Button>
        }
      >
        页面可以来自基础套件或其他已安装插件。
      </Empty>
    );
  else if (!plugin)
    page = (
      <Empty
        title="此页面的插件不可用"
        icon="layers"
        action={
          <Button onClick={() => setGraph(true)}>打开节点画布，替换页面</Button>
        }
      >
        {node.pluginId} · v{node.pluginVersion}
        <br />
        已有素材、时间线与页面配置保留在项目中。
      </Empty>
    );
  else if (node.definition.renderer === "builtin:media")
    page = <MediaPage key={node.id} node={node} />;
  else if (node.definition.renderer === "builtin:edit")
    page = <EditPage key={node.id} node={node} />;
  else if (node.definition.renderer === "builtin:export")
    page = <ExportPage key={node.id} />;
  else page = <PluginPage key={node.id} node={node} />;
  const gpu = resource?.devices[0];
  if (!desktop)
    return (
      <Empty title="请从桌面应用启动">
        在项目目录运行 npm run dev，将启动 Electron 与 Rust Core。
      </Empty>
    );
  return (
    <>
      <div className="app">
        {!project ? (
          <ProjectCenter
            plugins={plugins}
            onOpen={open}
            notify={notify}
            onPluginsChange={loadPlugins}
          />
        ) : (
          <ProjectContext.Provider
            value={{
              project,
              plugins,
              command,
              execute,
              refresh,
              notify,
              openPage,
            }}
          >
            <WorkspaceMenu
              busy={busy > 0}
              onBack={() => {
                current.current = undefined;
                setProject(undefined);
              }}
              onGraph={() => setGraph(!graph)}
            />
            <div className="project-page">
              <PageBoundary key={`${active}-${plugin?.enabled}`}>
                {page}
              </PageBoundary>
            </div>
            {graph && <WorkspaceGraph onClose={() => setGraph(false)} />}
            {customizing && (
              <PageCustomization onClose={() => setCustomizing(false)} />
            )}
            <nav className="page-strip" aria-label="项目页面条">
              <div className="strip-context">
                <span className="status-dot" />
                本地项目
              </div>
              <div className="page-strip-items">
                {project.workspace.pages.map((n) => (
                  <button
                    key={n.id}
                    aria-current={active === n.id ? "page" : undefined}
                    className={active === n.id ? "active" : ""}
                    onClick={() => openPage(n.id)}
                  >
                    <Glyph name={n.definition.icon} size={20} />
                    <span>{n.definition.name}</span>
                    {!plugins.some(
                      (p) =>
                        p.enabled &&
                        p.manifest.id === n.pluginId &&
                        p.manifest.version === n.pluginVersion,
                    ) && <Unplug size={10} />}
                  </button>
                ))}
              </div>
              <button
                className={`graph-toggle ${graph ? "active" : ""}`}
                aria-expanded={graph}
                onClick={() => setGraph(!graph)}
              >
                <Workflow size={17} />
                <span>信息连接</span>
                {graph ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
              </button>
              <button
                className="graph-toggle"
                onClick={() => setCustomizing(true)}
              >
                自定义
              </button>
            </nav>
          </ProjectContext.Provider>
        )}
      </div>
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <IconButton label="关闭通知" onClick={() => setToast("")}>
            <X size={14} />
          </IconButton>
        </div>
      )}
    </>
  );
}
function PlusIcon() {
  return <span>＋</span>;
}
