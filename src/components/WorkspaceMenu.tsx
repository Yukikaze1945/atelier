import { useProject } from "../context";
import { host } from "../host";
import { useEffect, useRef } from "react";

export function WorkspaceMenu({
  busy,
  onBack,
  onGraph,
}: {
  busy: boolean;
  onBack: () => void;
  onGraph: () => void;
}) {
  const { project, execute, command, notify, openPage } = useProject();
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node))
        root.current
          ?.querySelectorAll("details[open]")
          .forEach((d) => d.removeAttribute("open"));
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape")
        root.current
          ?.querySelectorAll("details[open]")
          .forEach((d) => d.removeAttribute("open"));
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", key);
    };
  }, []);
  const event = (action: string) =>
    window.dispatchEvent(new CustomEvent("editor.action", { detail: action }));
  const open = (renderer: string) => {
    const node = project.workspace.pages.find(
      (n) => n.definition.renderer === renderer,
    );
    if (node) openPage(node.id);
  };
  return (
    <header
      className="editor-menubar"
      ref={root}
      onClickCapture={(e) => {
        const summary = (e.target as HTMLElement).closest("summary");
        if (summary) {
          const own = summary.parentElement;
          e.currentTarget.querySelectorAll("details[open]").forEach((d) => {
            if (d !== own) d.removeAttribute("open");
          });
        }
      }}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button"))
          e.currentTarget
            .querySelectorAll("details[open]")
            .forEach((d) => d.removeAttribute("open"));
      }}
    >
      <span className="menu-brand">AI 工作站</span>
      <details>
        <summary>文件</summary>
        <div className="editor-menu">
          <button disabled={busy} onClick={onBack}>
            项目管理
          </button>
          <button
            onClick={() =>
              host
                .request("shell.showProject", { projectId: project.id })
                .catch((e) => notify(e.message))
            }
          >
            在文件夹中显示项目
          </button>
          <button onClick={() => open("builtin:export")}>导出</button>
        </div>
      </details>
      <details>
        <summary>编辑</summary>
        <div className="editor-menu">
          <button
            disabled={busy || !project.canUndo}
            onClick={() => execute("project.undo", {})}
          >
            撤销 <kbd>Ctrl+Z</kbd>
          </button>
          <button
            disabled={busy || !project.canRedo}
            onClick={() => execute("project.redo", {})}
          >
            重做 <kbd>Ctrl+Shift+Z</kbd>
          </button>
        </div>
      </details>
      <details>
        <summary>时间线</summary>
        <div className="editor-menu">
          <button
            onClick={() =>
              command({ type: "timeline.trackAdd", kind: "video" })
            }
          >
            添加视频轨道
          </button>
          <button
            onClick={() =>
              command({ type: "timeline.trackAdd", kind: "audio" })
            }
          >
            添加音频轨道
          </button>
          <button onClick={() => event("settings")}>时间线设置</button>
        </div>
      </details>
      <details>
        <summary>播放</summary>
        <div className="editor-menu">
          <button onClick={() => event("play")}>
            播放 / 暂停 <kbd>Space</kbd>
          </button>
          <button onClick={() => event("start")}>回到开头</button>
        </div>
      </details>
      <details>
        <summary>工作区</summary>
        <div className="editor-menu">
          {project.workspace.pages.map((n) => (
            <button key={n.id} onClick={() => openPage(n.id)}>
              {n.definition.name}
            </button>
          ))}
          <button onClick={onGraph}>信息连接</button>
          {!project.workspace.pages.some(
            (n) => n.pluginId === "org.workstation.moy-subtitles",
          ) && (
            <button
              onClick={() =>
                command({
                  type: "workspace.add",
                  pluginId: "org.workstation.moy-subtitles",
                  pageId: "subtitles",
                })
              }
            >
              添加字幕页
            </button>
          )}
        </div>
      </details>
      <span className="menu-document">
        {project.name}
        {busy ? " · 保存中" : ""}
      </span>
    </header>
  );
}
