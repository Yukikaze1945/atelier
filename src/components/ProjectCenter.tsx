import { useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  Search,
  LayoutGrid,
  List,
  FolderOpen,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  HardDrive,
  Workflow,
  ArrowRight,
  Folder,
  Layers3,
} from "lucide-react";
import type {
  PluginRecord,
  ProjectSummary,
  ProjectView,
  Workspace,
  WorkflowTemplate,
} from "../../packages/sdk/src";
import { host } from "../host";
import { Button, date, Empty, Glyph, IconButton, Modal } from "./ui";
import { PluginMarket } from "./PluginMarket";
import { VideoSettingsFields, defaultVideoSettings } from "./VideoSettings";

export function ProjectCenter({
  plugins,
  onOpen,
  notify,
  onPluginsChange,
}: {
  plugins: PluginRecord[];
  onOpen: (p: ProjectView) => void;
  notify: (s: string) => void;
  onPluginsChange: () => Promise<void>;
}) {
  const [tab, setTab] = useState("projects");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [search, setSearch] = useState("");
  const [list, setList] = useState(false);
  const [create, setCreate] = useState(false);
  const [template, setTemplate] = useState<WorkflowTemplate>();
  const [selected, setSelected] = useState<string>();
  const [thumbSize, setThumbSize] = useState(260);
  useEffect(() => {
    Promise.all([
      host.projects.list().then(setProjects),
      host.templates.list().then(setTemplates),
    ]).catch((e) => notify(e.message));
  }, []);
  const visible = useMemo(
    () =>
      projects.filter((p) =>
        p.name.toLowerCase().includes(search.toLowerCase()),
      ),
    [projects, search],
  );
  const picked = visible.find((p) => p.id === selected) || visible[0];
  async function openExisting() {
    try {
      const directory = await host.request<string | null>("dialog.directory", {
        title: "打开项目文件夹",
      });
      if (directory)
        onOpen(await host.request<ProjectView>("project.open", { directory }));
    } catch (error) {
      notify(String(error));
    }
  }
  async function openProject(project: ProjectSummary) {
    try {
      onOpen(await host.projects.get(project.id));
    } catch (error) {
      notify(String(error));
    }
  }
  const newProject = () => {
    setTemplate(undefined);
    setCreate(true);
  };
  return (
    <div className="center-shell">
      <header className="center-header">
        <nav className="center-tabs" aria-label="项目中心">
          <button
            className={tab === "projects" ? "active" : ""}
            onClick={() => setTab("projects")}
          >
            <HardDrive size={20} />
            本地项目
          </button>
          <button
            className={tab === "market" ? "active" : ""}
            onClick={() => setTab("market")}
          >
            <Layers3 size={20} />
            插件市场
          </button>
          <button
            className={tab === "templates" ? "active" : ""}
            onClick={() => setTab("templates")}
          >
            <Workflow size={20} />
            工作流模板
          </button>
        </nav>
        <div className="brand">
          <Layers3 size={24} />
          <span>AI 工作站</span>
        </div>
        <span className="build-badge">开发预览 · 0.1</span>
      </header>
      {tab === "projects" && (
        <main className="center-main project-manager">
          <div className="library-toolbar">
            <div className="manager-heading">
              <Folder size={17} />
              <h1>项目</h1>
              <span className="muted">{projects.length}</span>
            </div>
            <div className="spacer" />
            <input
              type="range"
              className="thumbnail-size"
              aria-label="项目缩略图大小"
              min={190}
              max={380}
              step={10}
              value={thumbSize}
              disabled={list}
              onChange={(e) => setThumbSize(Number(e.target.value))}
            />
            <span className="small muted">最近修改</span>
            <div className="segmented">
              <IconButton
                label="网格视图"
                aria-pressed={!list}
                onClick={() => setList(false)}
              >
                <LayoutGrid size={18} />
              </IconButton>
              <IconButton
                label="列表视图"
                aria-pressed={list}
                onClick={() => setList(true)}
              >
                <List size={18} />
              </IconButton>
            </div>
            <div className="search">
              <Search size={16} />
              <input
                aria-label="搜索项目"
                placeholder="搜索项目"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          {!projects.length ? (
            <Empty icon="folder" title="暂无本地项目">
              新建项目，或打开已有的项目文件夹。
            </Empty>
          ) : !visible.length ? (
            <Empty title="没有匹配的项目">换个名称试试。</Empty>
          ) : (
            <div
              className={list ? "project-list" : "project-grid"}
              style={
                list
                  ? undefined
                  : {
                      gridTemplateColumns: `repeat(auto-fill, minmax(${thumbSize}px, 1fr))`,
                    }
              }
            >
              {list && (
                <div className="project-list-heading" aria-hidden="true">
                  <span>名称</span>
                  <span>位置</span>
                  <div>
                    <span>素材 / 页面</span>
                    <span>修改时间</span>
                  </div>
                </div>
              )}
              {visible.map((p) => (
                <button
                  key={p.id}
                  className={`project-card ${picked?.id === p.id ? "selected" : ""} ${p.offline ? "offline" : ""}`}
                  aria-pressed={picked?.id === p.id}
                  onClick={() => setSelected(p.id)}
                  onDoubleClick={() => openProject(p)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void openProject(p);
                    }
                  }}
                >
                  {!list && <ProjectThumbnail project={p} />}
                  <div className="project-card-copy">
                    <h3>{p.name}</h3>
                    <p title={p.directory}>{p.directory}</p>
                    <div>
                      <span>
                        {p.assetCount} 素材 · {p.pageCount} 页面
                      </span>
                      <time>{date(p.modifiedAt)}</time>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </main>
      )}
      {tab === "market" && (
        <PluginMarket
          plugins={plugins}
          notify={notify}
          onChange={onPluginsChange}
        />
      )}
      {tab === "templates" && (
        <main className="center-main">
          <div className="section-heading">
            <div>
              <h1>工作流模板</h1>
              <p>保存页面、顺序、信息连接与选项。</p>
            </div>
          </div>
          <div className="template-grid">
            <button className="template-card" onClick={newProject}>
              <div className="template-flow">
                <Glyph name="library" />
                <ChevronRight />
                <Glyph name="scissors" />
                <ChevronRight />
                <Glyph name="rocket" />
              </div>
              <h3>基础剪辑工作区</h3>
              <p>素材 → 剪辑 → 导出</p>
              <span>
                内置 · 3 个页面 <ArrowRight size={16} />
              </span>
            </button>
            {templates.map((t) => (
              <button
                key={t.id}
                className="template-card"
                onClick={() => {
                  setTemplate(t);
                  setCreate(true);
                }}
              >
                <div className="template-flow">
                  {t.workspace.pages.map((n) => (
                    <Glyph key={n.id} name={n.definition.icon} />
                  ))}
                </div>
                <h3>{t.name}</h3>
                <p>
                  {t.workspace.pages.map((n) => n.definition.name).join(" → ")}
                </p>
                <span>
                  v{t.version} · {t.workspace.pages.length} 个页面{" "}
                  <ArrowRight size={16} />
                </span>
              </button>
            ))}
          </div>
          <p className="muted helper">
            在项目的节点画布中选择「保存为模板」来保存自己的组合。
          </p>
        </main>
      )}
      <footer className="center-footer">
        {tab === "projects" ? (
          <>
            <Button onClick={openExisting}>
              <FolderOpen size={15} />
              打开项目文件夹
            </Button>
            <span className="selected-project-path" title={picked?.directory}>
              {picked?.directory || "本地项目"}
            </span>
            <div className="spacer" />
            <Button className="primary" onClick={newProject}>
              新建项目
            </Button>
            <Button
              disabled={!picked}
              onClick={() => picked && openProject(picked)}
            >
              打开
            </Button>
          </>
        ) : (
          <>
            <span>本地工作空间</span>
            <div className="spacer" />
            <span>页面与插件自由组合</span>
          </>
        )}
      </footer>
      {create && (
        <CreateProject
          plugins={plugins}
          templates={templates}
          initialTemplate={template}
          onClose={() => setCreate(false)}
          onCreated={onOpen}
          notify={notify}
        />
      )}
    </div>
  );
}

function ProjectThumbnail({ project }: { project: ProjectSummary }) {
  const container = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<{ url: string; kind: string }>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (project.offline || !container.current) return;
    let alive = true;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      host.projects
        .get(project.id)
        .then(async (view) => {
          const asset =
            view.assets.find((a) => !a.archived && a.mediaType === "image") ||
            view.assets.find((a) => !a.archived && a.mediaType === "video");
          if (asset) {
            const url = await host.request<string>("asset.previewUrl", {
              projectId: project.id,
              assetId: asset.id,
            });
            if (alive) setPreview({ url, kind: asset.mediaType });
          }
        })
        .catch(() => {});
    });
    observer.observe(container.current);
    return () => {
      alive = false;
      observer.disconnect();
    };
  }, [project.id, project.modifiedAt, project.offline]);
  return (
    <div ref={container} className="project-art">
      {preview && !failed ? (
        preview.kind === "image" ? (
          <img src={preview.url} alt="" onError={() => setFailed(true)} />
        ) : (
          <video
            src={preview.url}
            muted
            preload="metadata"
            onError={() => setFailed(true)}
          />
        )
      ) : (
        <Layers3 size={50} strokeWidth={1.2} />
      )}
      <span className="project-selection-check" aria-hidden="true">
        ✓
      </span>
      {project.offline && <span className="project-chip">离线</span>}
    </div>
  );
}

function workspaceFromPlugins(plugins: PluginRecord[]): Workspace {
  const plugin = plugins.find((p) => p.builtin);
  if (!plugin) return { pages: [], links: [] };
  const pages = plugin.manifest.pages.map((d, i) => ({
    id: crypto.randomUUID(),
    pluginId: plugin.manifest.id,
    pluginVersion: plugin.manifest.version,
    definition: d,
    position: { x: 60 + i * 340, y: 100 },
    expanded: false,
    config: Object.fromEntries(d.options.map((o) => [o.id, o.default])),
    privateState: {},
  }));
  const links = pages.slice(1).flatMap((p, i) => {
    const a = pages[i].definition.ports.find(
      (port) => port.direction === "output",
    );
    const b = p.definition.ports.find(
      (port) => port.direction === "input" && port.dataType === a?.dataType,
    );
    return a && b
      ? [
          {
            id: crypto.randomUUID(),
            source: pages[i].id,
            sourcePort: a.id,
            target: p.id,
            targetPort: b.id,
            dataType: a.dataType,
          },
        ]
      : [];
  });
  return { pages, links };
}

function CreateProject({
  plugins,
  templates,
  initialTemplate,
  onClose,
  onCreated,
  notify,
}: {
  plugins: PluginRecord[];
  templates: WorkflowTemplate[];
  initialTemplate?: WorkflowTemplate;
  onClose: () => void;
  onCreated: (p: ProjectView) => void;
  notify: (s: string) => void;
}) {
  const [name, setName] = useState("未命名项目");
  const [directory, setDirectory] = useState("");
  const [preset, setPreset] = useState("editing");
  const [videoSettings, setVideoSettings] = useState(defaultVideoSettings);
  const [templateId, setTemplateId] = useState(
    initialTemplate?.id || "builtin.standard",
  );
  const [workspace, setWorkspace] = useState<Workspace>(() =>
    structuredClone(
      initialTemplate?.workspace || workspaceFromPlugins(plugins),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    host
      .request<string>("files.defaultDirectory")
      .then(setDirectory)
      .catch((e) => notify(e.message));
  }, []);
  function chooseTemplate(id: string) {
    setTemplateId(id);
    setWorkspace(
      structuredClone(
        templates.find((t) => t.id === id)?.workspace ||
          workspaceFromPlugins(plugins),
      ),
    );
  }
  async function chooseDirectory() {
    try {
      const next = await host.request<string | null>("dialog.directory", {
        defaultPath: directory,
        title: "选择项目保存位置",
      });
      if (next) setDirectory(next);
    } catch (e) {
      setError(String(e));
    }
  }
  async function createProject() {
    setBusy(true);
    setError("");
    try {
      onCreated(
        await host.request<ProjectView>("project.create", {
          name,
          parentDirectory: directory,
          projectTemplate: preset,
          timelineSettings: videoSettings,
          templateId,
          workspace,
        }),
      );
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }
  function move(index: number, delta: number) {
    setWorkspace((w) => {
      const pages = [...w.pages];
      [pages[index], pages[index + delta]] = [
        pages[index + delta],
        pages[index],
      ];
      return { ...w, pages };
    });
  }
  return (
    <Modal
      title="新建项目"
      subtitle="为创作选择一个起点，页面组合以后仍可更改。"
      onClose={onClose}
      wide
    >
      <div className="create-layout">
        <div className="form-stack">
          <label>
            项目名称
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label="项目名称"
            />
          </label>
          <label>
            保存位置
            <div className="path-field">
              <input
                value={directory}
                onChange={(e) => setDirectory(e.target.value)}
                aria-label="项目保存位置"
              />
              <IconButton label="选择项目保存位置" onClick={chooseDirectory}>
                <Folder size={18} />
              </IconButton>
            </div>
            <small>将在此位置新建「{name || "项目名称"}」文件夹</small>
          </label>
          <label>
            项目模板
            <select value={preset} onChange={(e) => setPreset(e.target.value)}>
              <option value="editing">基础剪辑 · 创建时间线</option>
              <option value="blank">空白工程 · 暂不创建时间线</option>
            </select>
          </label>
          {preset === "editing" && (
            <VideoSettingsFields
              value={videoSettings}
              onChange={setVideoSettings}
            />
          )}
          <label>
            页面与插件组合
            <select
              value={templateId}
              onChange={(e) => chooseTemplate(e.target.value)}
            >
              <option value="builtin.standard">基础剪辑工作区</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} · v{t.version}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="create-workspace">
          <div className="eyebrow">项目的页面条</div>
          <h3>你的工作区</h3>
          <p>调整顺序，并展开页面的高级选项。</p>
          <div className="create-pages">
            {workspace.pages.map((node, i) => (
              <div className="create-page" key={node.id}>
                <div className="create-page-title">
                  <span className="step-number">0{i + 1}</span>
                  <Glyph name={node.definition.icon} />
                  <strong>{node.definition.name}</strong>
                  <div className="spacer" />
                  <IconButton
                    label={`上移${node.definition.name}`}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUp size={14} />
                  </IconButton>
                  <IconButton
                    label={`下移${node.definition.name}`}
                    disabled={i === workspace.pages.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown size={14} />
                  </IconButton>
                </div>
                {node.definition.options.length > 0 && (
                  <details>
                    <summary>高级选项</summary>
                    {node.definition.options
                      .filter((o) => o.type === "select")
                      .map((o) => (
                        <label key={o.id}>
                          {o.label}
                          <select
                            value={String(node.config[o.id])}
                            onChange={(e) =>
                              setWorkspace((w) => ({
                                ...w,
                                pages: w.pages.map((n) =>
                                  n.id === node.id
                                    ? {
                                        ...n,
                                        config: {
                                          ...n.config,
                                          [o.id]: e.target.value,
                                        },
                                      }
                                    : n,
                                ),
                              }))
                            }
                          >
                            {o.choices?.map((c) => (
                              <option key={c.value} value={c.value}>
                                {c.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      ))}
                  </details>
                )}
              </div>
            ))}
          </div>
          <div className="note">
            <Layers3 size={15} />
            进入项目后可添加、替换和连接插件页面。
          </div>
        </div>
      </div>
      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
      <footer className="modal-footer">
        <span className="muted">
          {workspace.pages.length} 个页面 · {workspace.links.length} 条信息连接
        </span>
        <div className="spacer" />
        <Button onClick={onClose}>取消</Button>
        <Button
          className="primary"
          disabled={busy || !name.trim() || !directory}
          onClick={createProject}
        >
          {busy ? "正在创建…" : "创建项目"}
          <ArrowRight size={16} />
        </Button>
      </footer>
    </Modal>
  );
}
