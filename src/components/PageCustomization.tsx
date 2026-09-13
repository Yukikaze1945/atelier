import { useState } from "react";
import { useProject } from "../context";
import { Button, Modal } from "./ui";
import { PagePicker } from "./WorkspaceGraph";
import { host } from "../host";

export function PageCustomization({ onClose }: { onClose: () => void }) {
  const { project, command, notify } = useProject();
  const [adding, setAdding] = useState(false),
    [drag, setDrag] = useState<string>();
  const [name, setName] = useState(`${project.name} 页面组合`);
  function move(from: string, to: string) {
    const ids = project.workspace.pages.map((n) => n.id);
    const a = ids.indexOf(from),
      b = ids.indexOf(to);
    if (a < 0 || b < 0 || a === b) return;
    ids.splice(a, 1);
    ids.splice(b, 0, from);
    void command({ type: "workspace.reorder", nodeIds: ids });
  }
  return (
    <>
      <Modal
        title="自定义页面栏"
        subtitle="拖动条目调整顺序；移除页面不会删除素材和剪辑。"
        onClose={onClose}
      >
        <div className="modal-body page-customize-list">
          {project.workspace.pages.map((n, i) => (
            <div
              key={n.id}
              draggable
              onDragStart={(e) => {
                setDrag(n.id);
                e.dataTransfer.setData("text/plain", n.id);
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                move(drag || e.dataTransfer.getData("text/plain"), n.id);
                setDrag(undefined);
              }}
            >
              <span>⠿</span>
              <strong>{n.definition.name}</strong>
              <span className="spacer" />
              <button
                disabled={!i}
                onClick={() => move(n.id, project.workspace.pages[i - 1].id)}
              >
                ↑
              </button>
              <button
                disabled={i === project.workspace.pages.length - 1}
                onClick={() => move(n.id, project.workspace.pages[i + 1].id)}
              >
                ↓
              </button>
              <button
                onClick={() =>
                  command({ type: "workspace.remove", nodeId: n.id })
                }
              >
                移除
              </button>
            </div>
          ))}
          <Button onClick={() => setAdding(true)}>＋ 添加页面</Button>
          <label>
            模板名称
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
        </div>
        <footer className="modal-footer">
          <Button
            disabled={!name.trim()}
            onClick={() =>
              host
                .request("template.save", { projectId: project.id, name })
                .then(() => notify("页面组合已保存为模板"))
                .catch((e) => notify(String(e)))
            }
          >
            保存为模板
          </Button>
          <Button onClick={onClose}>完成</Button>
        </footer>
      </Modal>
      {adding && <PagePicker onClose={() => setAdding(false)} />}
    </>
  );
}
