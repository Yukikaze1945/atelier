import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  FolderOpen,
  ArrowUp,
  Import,
  Archive,
  RotateCcw,
  Plus,
  List,
  LayoutGrid,
  HardDrive,
  ChevronRight,
  Image as ImageIcon,
  Volume2,
  FileQuestion,
  SlidersHorizontal,
} from "lucide-react";
import type {
  Asset,
  DirectoryListing,
  FileEntry,
  PageNode,
  ProjectView,
} from "../../packages/sdk/src";
import { desktop, host } from "../host";
import { useProject } from "../context";
import { Button, bytes, Empty, Glyph, IconButton, secondsLabel } from "./ui";

export function useAssetUrl(projectId: string, asset: Asset | undefined) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let live = true;
    setUrl(undefined);
    if (asset)
      host
        .request<string>("asset.previewUrl", { projectId, assetId: asset.id })
        .then((value) => {
          if (live) setUrl(value);
        })
        .catch(() => {});
    return () => {
      live = false;
    };
  }, [projectId, asset?.id, asset?.sourceUri, asset?.projectPath]);
  return url;
}

export function AssetThumbnail({
  asset,
  projectId,
}: {
  asset: Asset;
  projectId: string;
}) {
  const url = useAssetUrl(projectId, asset);
  const [failed, setFailed] = useState(false);
  return asset.mediaType === "image" && url && !failed ? (
    <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} />
  ) : (
    <Glyph name={asset.mediaType} size={25} />
  );
}

export function MediaPreview({
  url,
  kind,
  name,
  onMetadata,
}: {
  url?: string;
  kind: string;
  name: string;
  onMetadata?: (meta: Record<string, unknown>) => void;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  if (!url)
    return (
      <div className="preview-placeholder">
        <Glyph name={kind || "video"} size={36} />
        <span>{name || "选择素材进行预览"}</span>
      </div>
    );
  if (failed)
    return (
      <div className="preview-placeholder">
        <FileQuestion size={32} />
        <span>素材离线或此格式暂不支持兼容预览</span>
        <small>原生 GES 解码路径待接入</small>
      </div>
    );
  if (kind === "image")
    return (
      <img
        className="source-image"
        src={url}
        alt={name}
        onError={() => setFailed(true)}
        onLoad={(e) =>
          onMetadata?.({
            width: e.currentTarget.naturalWidth,
            height: e.currentTarget.naturalHeight,
          })
        }
      />
    );
  if (kind === "video")
    return (
      <video
        key={url}
        src={url}
        controls
        preload="metadata"
        onError={() => setFailed(true)}
        onLoadedMetadata={(e) => {
          const video = e.currentTarget;
          onMetadata?.({
            duration: video.duration,
            width: video.videoWidth,
            height: video.videoHeight,
          });
        }}
      />
    );
  if (kind === "audio")
    return (
      <div className="audio-preview">
        <Volume2 size={40} />
        <span>{name}</span>
        <audio
          key={url}
          src={url}
          controls
          preload="metadata"
          onError={() => setFailed(true)}
          onLoadedMetadata={(e) =>
            onMetadata?.({ duration: e.currentTarget.duration })
          }
        />
      </div>
    );
  return (
    <div className="preview-placeholder">
      <Glyph name={kind} size={36} />
      <span>{name}</span>
      <small>此类素材可保存并传给插件，尚无内置预览器。</small>
    </div>
  );
}

export async function probeFiles(
  paths: string[],
): Promise<{ path: string; metadata: Record<string, unknown> }[]> {
  const results = [];
  for (const path of paths) {
    const ext = path.split(".").pop()?.toLowerCase() || "";
    if (
      ![
        "mp4",
        "webm",
        "mov",
        "m4v",
        "mp3",
        "wav",
        "flac",
        "aac",
        "ogg",
        "m4a",
      ].includes(ext)
    ) {
      results.push({ path, metadata: {} });
      continue;
    }
    const metadata: Record<string, unknown> = await new Promise((resolve) => {
      const video = document.createElement("video");
      let settled = false;
      const finish = (data: Record<string, unknown>) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        video.removeAttribute("src");
        video.load();
        resolve(data);
      };
      const timer = setTimeout(() => finish({}), 3500);
      video.preload = "metadata";
      video.onloadedmetadata = () =>
        finish(
          Number.isFinite(video.duration)
            ? {
                duration: video.duration,
                width: video.videoWidth,
                height: video.videoHeight,
              }
            : {},
        );
      video.onerror = () => finish({});
      host
        .request<string>("files.previewUrl", { path })
        .then((url) => {
          if (!settled) video.src = url;
        })
        .catch(() => finish({}));
    });
    results.push({ path, metadata });
  }
  return results;
}

export function MediaPage({ node }: { node: PageNode }) {
  const { project, command, execute, notify, openPage } = useProject();
  const [roots, setRoots] = useState<{ name: string; path: string }[]>([]);
  const [directory, setDirectory] = useState("");
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [source, setSource] = useState<FileEntry | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [list, setList] = useState(false);
  const [busy, setBusy] = useState(false);
  const [drop, setDrop] = useState(false);
  const [error, setError] = useState("");
  const [limit, setLimit] = useState(60);
  const selectedAsset = project.assets.find((a) => a.id === selected);
  const assetUrl = useAssetUrl(project.id, selectedAsset);
  useEffect(() => {
    host
      .request<{ name: string; path: string }[]>("files.roots")
      .then(setRoots)
      .catch((e) => notify(e.message));
    host
      .request<string>("files.defaultDirectory")
      .then(setDirectory)
      .catch((e) => notify(e.message));
  }, []);
  useEffect(() => {
    let live = true;
    if (!directory) return;
    setError("");
    setListing(null);
    host
      .request<DirectoryListing>("files.browse", { directory })
      .then((value) => {
        if (live) setListing(value);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [directory]);
  useEffect(() => {
    let live = true;
    setSourceUrl(undefined);
    if (source)
      host
        .request<string>("files.previewUrl", { path: source.path })
        .then((url) => {
          if (live) setSourceUrl(url);
        })
        .catch(() => {});
    return () => {
      live = false;
    };
  }, [source]);
  const assets = useMemo(
    () =>
      project.assets.filter(
        (a) =>
          (category === "archive" ? a.archived : !a.archived) &&
          (category === "all" ||
            category === "archive" ||
            a.mediaType === category) &&
          `${a.name} ${JSON.stringify(a.metadata)}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [project.assets, category, query],
  );
  async function importPaths(paths: string[]) {
    if (!paths.length) return;
    setBusy(true);
    try {
      const files = await probeFiles(paths);
      const result = await execute("asset.import", {
        files,
        mode: node.config.importMode || "link",
      });
      if (result) {
        notify(
          `已导入素材，使用${node.config.importMode === "copy" ? "复制" : "链接"}模式。`,
        );
        setCategory("all");
      }
    } catch (e) {
      notify(String(e));
    } finally {
      setBusy(false);
      setDrop(false);
    }
  }
  async function chooseFiles() {
    try {
      await importPaths(await host.request<string[]>("dialog.files"));
    } catch (e) {
      notify(String(e));
    }
  }
  async function chooseDirectory() {
    try {
      const next = await host.request<string | null>("dialog.directory", {
        title: "浏览素材文件夹",
      });
      if (next) setDirectory(next);
    } catch (e) {
      notify(String(e));
    }
  }
  async function dropped(event: React.DragEvent) {
    event.preventDefault();
    setDrop(false);
    let paths: string[] = [];
    const local = event.dataTransfer.getData("application/x-workstation-files");
    if (local) {
      try {
        paths = JSON.parse(local);
      } catch {
        return;
      }
    } else
      paths = [...event.dataTransfer.files]
        .map((f) => desktop.pathForFile(f))
        .filter(Boolean);
    await importPaths(paths);
  }
  async function addToTimeline() {
    if (!selectedAsset) return;
    const timeline = project.timeline;
    if (!timeline) {
      notify("当前项目还没有时间线，请先在剪辑页创建。");
      return;
    }
    const track = selectedAsset.mediaType === "audio" ? "a1" : "v1";
    const result = await command({
      type: "timeline.add",
      assetId: selectedAsset.id,
      trackId: track,
    });
    if (result) {
      const edit = project.workspace.pages.find(
        (n) => n.definition.type === "timeline",
      );
      if (edit) openPage(edit.id);
    }
  }
  function metadata(meta: Record<string, unknown>) {
    if (!selectedAsset) return;
    const changed = Object.fromEntries(
      Object.entries(meta).filter(
        ([k, v]) =>
          typeof v === "number" &&
          Number.isFinite(v) &&
          selectedAsset.metadata[k] !== v,
      ),
    );
    if (Object.keys(changed).length)
      void command({
        type: "asset.metadata",
        assetId: selectedAsset.id,
        metadata: changed,
      });
  }
  const sourceKind = source
    ? /\.(png|jpg|jpeg|webp|gif|bmp)$/i.test(source.name)
      ? "image"
      : /\.(mp3|wav|flac|aac|ogg|m4a)$/i.test(source.name)
        ? "audio"
        : "video"
    : "";
  return (
    <div className="media-page">
      <div className="media-upper">
        <aside className="source-sidebar">
          <div className="pane-heading">
            <HardDrive size={15} />
            媒体存储
            <IconButton label="添加素材位置" onClick={chooseDirectory}>
              <Plus size={15} />
            </IconButton>
          </div>
          <div className="source-roots">
            {roots.map((root) => (
              <button
                key={root.path}
                className={directory.startsWith(root.path) ? "active" : ""}
                onClick={() => setDirectory(root.path)}
              >
                <ChevronRight size={12} />
                <HardDrive size={14} />
                {root.name}
              </button>
            ))}
          </div>
          <div className="sidebar-bottom">
            <span>硬盘文件</span>
            <small>拖入下方素材库即可导入</small>
          </div>
        </aside>
        <section className="source-browser">
          <div className="pane-toolbar">
            <IconButton
              label="上一级文件夹"
              onClick={() => listing && setDirectory(listing.parent)}
              disabled={!listing}
            >
              <ArrowUp size={15} />
            </IconButton>
            <span title={directory} className="path-text">
              {directory || "选择素材位置"}
            </span>
            <IconButton label="打开素材文件夹" onClick={chooseDirectory}>
              <FolderOpen size={16} />
            </IconButton>
          </div>
          <div className="source-grid">
            {error ? (
              <p className="inline-error">{error}</p>
            ) : !listing ? (
              <p className="muted">正在读取目录…</p>
            ) : listing.entries.length ? (
              listing.entries.map((file) => (
                <button
                  key={file.path}
                  className={source?.path === file.path ? "selected" : ""}
                  onClick={() => {
                    if (!file.directory) {
                      setSource(file);
                      setSelected(undefined);
                    }
                  }}
                  onDoubleClick={() =>
                    file.directory
                      ? setDirectory(file.path)
                      : void importPaths([file.path])
                  }
                  draggable={!file.directory}
                  onDragStart={(e) =>
                    e.dataTransfer.setData(
                      "application/x-workstation-files",
                      JSON.stringify([file.path]),
                    )
                  }
                >
                  <Glyph
                    name={
                      file.directory
                        ? "folder"
                        : /\.(mp4|mov|webm|mkv)$/i.test(file.name)
                          ? "video"
                          : /\.(png|jpg|jpeg|webp)$/i.test(file.name)
                            ? "image"
                            : "file"
                    }
                    size={36}
                  />
                  <span title={file.name}>{file.name}</span>
                </button>
              ))
            ) : (
              <p className="muted">此文件夹为空。</p>
            )}
          </div>
          {listing?.truncated && (
            <p className="note">
              当前仅显示前 2,000 项，请进入子文件夹缩小范围。
            </p>
          )}
        </section>
        <section className="media-monitor">
          <div className="pane-heading">
            {selectedAsset?.name || source?.name || "源素材预览"}
            <span className="spacer" />
            <span className="small muted">兼容预览</span>
          </div>
          <div className="monitor-surface">
            <MediaPreview
              url={selectedAsset ? assetUrl : sourceUrl}
              kind={selectedAsset?.mediaType || sourceKind}
              name={selectedAsset?.name || source?.name || ""}
              onMetadata={selectedAsset ? metadata : undefined}
            />
          </div>
          <div className="monitor-footer">
            <span>
              {selectedAsset
                ? bytes(selectedAsset.size)
                : "硬盘 → 素材库 → 时间线"}
            </span>
            {source && !selectedAsset && (
              <Button
                disabled={busy}
                onClick={() => importPaths([source.path])}
              >
                <Import size={13} />
                导入此素材
              </Button>
            )}
          </div>
        </section>
      </div>
      <div
        className={`media-lower ${drop ? "drop-active" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrop(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node))
            setDrop(false);
        }}
        onDrop={dropped}
      >
        <aside className="library-sidebar">
          <div className="pane-heading">
            <Glyph name="library" size={15} />
            项目素材库
          </div>
          {[
            ["all", "全部素材", "library"],
            ["video", "视频", "video"],
            ["audio", "音频", "audio"],
            ["image", "图片", "image"],
            ["subtitle", "字幕", "subtitle"],
          ].map(([id, name, icon]) => (
            <button
              key={id}
              className={category === id ? "active" : ""}
              onClick={() => {
                setCategory(id);
                setLimit(60);
              }}
            >
              <Glyph name={icon} size={15} />
              {name}
              <span>
                {
                  project.assets.filter(
                    (a) => !a.archived && (id === "all" || a.mediaType === id),
                  ).length
                }
              </span>
            </button>
          ))}
          <div className="spacer" />
          <button
            className={category === "archive" ? "active" : ""}
            onClick={() => setCategory("archive")}
          >
            <Archive size={15} />
            归档
            <span>
              {project.assets.filter((a) => a.archived).length +
                project.archive.length}
            </span>
          </button>
        </aside>
        <section className="media-library">
          <div className="pane-toolbar">
            <div className="search">
              <Search size={14} />
              <input
                aria-label="搜索素材"
                placeholder="搜索名称、元数据"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setLimit(60);
                }}
              />
            </div>
            <button
              className="semantic-pending"
              title="WeMM-Embedding-2B 等 Embedding 模型尚未接入"
              disabled
            >
              语义搜索 · 待接入
            </button>
            <div className="spacer" />
            <IconButton label="切换素材视图" onClick={() => setList(!list)}>
              {list ? <LayoutGrid size={16} /> : <List size={16} />}
            </IconButton>
            <Button onClick={chooseFiles} disabled={busy}>
              <Plus size={15} />
              {busy ? "导入中…" : "导入素材"}
            </Button>
          </div>
          {assets.length ? (
            <div className={list ? "asset-list" : "asset-grid"}>
              {assets.slice(0, limit).map((asset) => (
                <button
                  key={asset.id}
                  className={`asset-card ${selected === asset.id ? "selected" : ""}`}
                  onClick={() => {
                    setSelected(asset.id);
                    setSource(null);
                  }}
                  draggable={!asset.archived}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(
                      "application/x-workstation-asset",
                      asset.id,
                    );
                    e.currentTarget.dataset.draggingAsset = asset.id;
                  }}
                  onDragEnd={(e) => {
                    delete e.currentTarget.dataset.draggingAsset;
                    window.dispatchEvent(new Event("editor.dragEnd"));
                  }}
                >
                  <div className="asset-thumb">
                    <AssetThumbnail asset={asset} projectId={project.id} />
                    <span>
                      {asset.mediaType === "video" &&
                      typeof asset.metadata.duration === "number"
                        ? secondsLabel(asset.metadata.duration)
                        : asset.mediaType.toUpperCase()}
                    </span>
                  </div>
                  <strong title={asset.name}>{asset.name}</strong>
                  <small>
                    {bytes(asset.size)} · {asset.projectPath ? "副本" : "链接"}
                  </small>
                </button>
              ))}
              {assets.length > limit && (
                <Button onClick={() => setLimit(limit + 60)}>
                  显示更多（余 {assets.length - limit}）
                </Button>
              )}
            </div>
          ) : (
            <Empty
              icon={category === "archive" ? "folder" : "library"}
              title={
                category === "archive"
                  ? "没有归档素材"
                  : query
                    ? "没有匹配的素材"
                    : "把素材放进你的项目"
              }
              action={
                category !== "archive" && !query ? (
                  <Button onClick={chooseFiles}>
                    <Plus size={15} />
                    选择素材
                  </Button>
                ) : undefined
              }
            >
              {category === "archive"
                ? "归档的素材可以随时找回。"
                : "从上方文件夹或资源管理器拖入视频、音频和图片。"}
            </Empty>
          )}
          {category === "archive" && project.archive.length > 0 && (
            <div className="archive-records">
              <span className="eyebrow">页面与片段恢复记录</span>
              {project.archive.map((entry) => (
                <div key={entry.id}>
                  <Glyph
                    name={entry.kind === "clip" ? "video" : "layers"}
                    size={16}
                  />
                  <span>{entry.label}</span>
                  <small>{entry.kind}</small>
                  <Button
                    onClick={() =>
                      command({ type: "archive.restore", archiveId: entry.id })
                    }
                  >
                    <RotateCcw size={13} />
                    恢复
                  </Button>
                </div>
              ))}
            </div>
          )}
          <footer className="library-footer">
            <span>{assets.length} 项</span>
            <span>
              导入方式：
              {node.config.importMode === "copy"
                ? "复制进项目"
                : "链接原文件"}{" "}
              · 在节点高级选项中更改
            </span>
          </footer>
        </section>
        <aside className="asset-inspector">
          <div className="pane-heading">
            <SlidersHorizontal size={14} />
            素材信息
          </div>
          {selectedAsset ? (
            <div className="inspector-body">
              <Glyph name={selectedAsset.mediaType} size={28} />
              <h3>{selectedAsset.name}</h3>
              <dl>
                <dt>类型</dt>
                <dd>{selectedAsset.mediaType}</dd>
                <dt>大小</dt>
                <dd>{bytes(selectedAsset.size)}</dd>
                <dt>来源</dt>
                <dd>{selectedAsset.projectPath ? "项目副本" : "链接文件"}</dd>
                <dt>版本</dt>
                <dd>{selectedAsset.revision}</dd>
                {typeof selectedAsset.metadata.duration === "number" && (
                  <>
                    <dt>时长</dt>
                    <dd>{selectedAsset.metadata.duration.toFixed(2)} 秒</dd>
                  </>
                )}
              </dl>
              <p className="asset-id">
                Asset ID
                <br />
                {selectedAsset.id}
              </p>
              {selectedAsset.archived ? (
                <Button
                  onClick={() =>
                    command({
                      type: "asset.restore",
                      assetId: selectedAsset.id,
                    })
                  }
                >
                  <RotateCcw size={14} />
                  恢复素材
                </Button>
              ) : (
                <>
                  <Button
                    disabled={
                      !["video", "audio", "image"].includes(
                        selectedAsset.mediaType,
                      )
                    }
                    onClick={addToTimeline}
                  >
                    <Plus size={14} />
                    添加到时间线
                  </Button>
                  <button
                    className="text-button muted"
                    onClick={() =>
                      command({
                        type: "asset.archive",
                        assetId: selectedAsset.id,
                      })
                    }
                  >
                    <Archive size={14} />
                    归档素材
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="inspector-empty">
              <ImageIcon size={24} />
              <p>选择素材查看信息</p>
            </div>
          )}
        </aside>
        {drop && (
          <div className="drop-label">
            <Import size={25} />
            <strong>松开以导入项目素材库</strong>
          </div>
        )}
      </div>
    </div>
  );
}
