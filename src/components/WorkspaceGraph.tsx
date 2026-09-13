import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  MarkerType,
  useNodesState,
  type Node,
  type NodeProps,
  type Connection,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Plus,
  ChevronDown,
  ChevronUp,
  Eye,
  Pin,
  X,
  Replace,
  ArrowLeft,
  ArrowRight,
  Save,
  Unplug,
  WandSparkles,
  Trash2,
  Check,
  ExternalLink,
} from "lucide-react";
import {
  autoConnections,
  compatibleLink,
  type PageNode as PageNodeModel,
  type PageDefinition,
  type PluginRecord,
  type ReplacementReport,
} from "../../packages/sdk/src";
import { host } from "../host";
import { useProject } from "../context";
import { Button, Glyph, IconButton, Modal } from "./ui";

type FlowNode = Node<
  {
    model: PageNodeModel;
    available: boolean;
    mode: string;
    onPreview: (nodeId: string, action: "hover" | "leave" | "toggle") => void;
    onReplace: (id: string) => void;
  },
  "page"
>;

function PageNodeView({ data, selected }: NodeProps<FlowNode>) {
  const { command, project } = useProject();
  const node = data.model;
  return (
    <div
      className={`page-node ${selected ? "selected" : ""} ${!data.available ? "missing" : ""}`}
      data-testid={`page-node-${node.definition.id}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="__page-in"
        isConnectable={false}
        style={{ opacity: 0, top: 22 }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="__page-out"
        isConnectable={false}
        style={{ opacity: 0, top: 22 }}
      />
      <div className="node-cap">
        <button
          aria-label={`预览${node.definition.name}页面`}
          className="node-preview-button nodrag"
          onMouseEnter={() => data.onPreview(node.id, "hover")}
          onMouseLeave={() => data.onPreview(node.id, "leave")}
          onFocus={() => data.onPreview(node.id, "hover")}
          onBlur={() => data.onPreview(node.id, "leave")}
          onClick={() => data.onPreview(node.id, "toggle")}
        >
          <Eye size={16} />
        </button>
        <div className="node-title">
          <Glyph name={node.definition.icon} />
          {node.definition.name}
        </div>
        <button
          className="node-fold nodrag"
          aria-label={`${node.expanded ? "收起" : "展开"}${node.definition.name}节点`}
          onClick={() =>
            command({
              type: "workspace.configure",
              nodeId: node.id,
              expanded: !node.expanded,
            })
          }
        >
          {node.expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>
      <div className="node-package">
        <span>{node.pluginId}</span>
        <span>v{node.pluginVersion}</span>
      </div>
      <div
        className="node-ports"
        style={{ height: 26 + node.definition.ports.length * 29 }}
      >
        {node.definition.ports.map((port, i) => (
          <div
            key={port.id}
            className={`port-row ${port.direction}`}
            style={{ top: 12 + i * 29 }}
          >
            <Handle
              type={port.direction === "input" ? "target" : "source"}
              position={
                port.direction === "input" ? Position.Left : Position.Right
              }
              id={port.id}
              isConnectable={data.mode === "information" && data.available}
              className={
                port.dataType.includes("timeline")
                  ? "timeline-handle"
                  : "assets-handle"
              }
            />
            <span>{port.label}</span>
          </div>
        ))}
      </div>
      {node.expanded && (
        <div className="node-options nodrag nowheel">
          <div className="eyebrow">高级选项</div>
          {node.definition.options.length ? (
            node.definition.options.map((field) => (
              <label key={field.id}>
                {field.label}
                {field.type === "select" ? (
                  <select
                    value={String(node.config[field.id] ?? field.default)}
                    onChange={(e) =>
                      command({
                        type: "workspace.configure",
                        nodeId: node.id,
                        config: { [field.id]: e.target.value },
                      })
                    }
                  >
                    {field.choices?.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                ) : field.type === "boolean" ? (
                  <input
                    type="checkbox"
                    checked={Boolean(node.config[field.id] ?? field.default)}
                    onChange={(e) =>
                      command({
                        type: "workspace.configure",
                        nodeId: node.id,
                        config: { [field.id]: e.target.checked },
                      })
                    }
                  />
                ) : (
                  <input
                    type={field.type === "number" ? "number" : "text"}
                    defaultValue={String(
                      node.config[field.id] ?? field.default ?? "",
                    )}
                    min={field.min}
                    max={field.max}
                    onBlur={(e) =>
                      command({
                        type: "workspace.configure",
                        nodeId: node.id,
                        config: {
                          [field.id]:
                            field.type === "number"
                              ? Number(e.target.value)
                              : e.target.value,
                        },
                      })
                    }
                  />
                )}
              </label>
            ))
          ) : (
            <p className="muted small">该页面没有额外选项。</p>
          )}
        </div>
      )}
      <div className="node-bottom">
        <span>
          {data.available ? (
            <>
              <span className="status-dot" />
              {node.definition.type}
            </>
          ) : (
            <>
              <Unplug size={12} />
              插件缺失 / 版本不匹配
            </>
          )}
        </span>
        <div className="node-reorder nodrag">
          <IconButton
            label={`替换${node.definition.name}节点`}
            onClick={() => data.onReplace(node.id)}
          >
            <Replace size={13} />
          </IconButton>
        </div>
      </div>
    </div>
  );
}
const nodeTypes = { page: PageNodeView };

export function WorkspaceGraph({ onClose }: { onClose: () => void }) {
  const { project, plugins, command, notify } = useProject();
  const mode = "information";
  const [replaceId, setReplaceId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [save, setSave] = useState(false);
  const [templateName, setTemplateName] = useState(`${project.name} 工作区`);
  const [preview, setPreview] = useState<{
    nodeId: string;
    pinned: boolean;
  } | null>(null);
  const [menu, setMenu] = useState<{
    nodeId: string;
    x: number;
    y: number;
  } | null>(null);
  const onPreview = useCallback(
    (nodeId: string, action: "hover" | "leave" | "toggle") =>
      setPreview((p) =>
        action === "leave"
          ? p?.pinned
            ? p
            : null
          : action === "hover"
            ? p?.pinned
              ? p
              : { nodeId, pinned: false }
            : p?.nodeId === nodeId && p.pinned
              ? null
              : { nodeId, pinned: true },
      ),
    [],
  );
  const flowNodes = useMemo<FlowNode[]>(
    () =>
      project.workspace.pages.map((node) => ({
        id: node.id,
        position: node.position,
        type: "page",
        deletable: false,
        dragHandle: ".node-cap",
        data: {
          model: node,
          available: plugins.some(
            (p) =>
              p.enabled &&
              p.manifest.id === node.pluginId &&
              p.manifest.version === node.pluginVersion,
          ),
          mode,
          onPreview,
          onReplace: setReplaceId,
        },
      })),
    [project.workspace.pages, plugins, mode, onPreview],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(flowNodes);
  useEffect(() => {
    // Preserve React Flow's measured dimensions and selection when Core publishes a snapshot.
    // Replacing these with fresh unmeasured nodes makes an unchanged card temporarily invisible.
    setNodes((previous) =>
      flowNodes.map((node) => ({
        ...previous.find((p) => p.id === node.id),
        ...node,
      })),
    );
  }, [flowNodes, setNodes]);
  const edges: Edge[] = project.workspace.links
    .filter(
      (l) =>
        project.workspace.pages.some((n) => n.id === l.source) &&
        project.workspace.pages.some((n) => n.id === l.target),
    )
    .map((l) => ({
      id: l.id,
      type: "smoothstep",
      markerEnd: { type: MarkerType.ArrowClosed },
      interactionWidth: 22,
      source: l.source,
      target: l.target,
      sourceHandle: project.workspace.pages
        .find((n) => n.id === l.source)
        ?.definition.ports.some((p) => p.id === l.sourcePort)
        ? l.sourcePort
        : "__page-out",
      targetHandle: project.workspace.pages
        .find((n) => n.id === l.target)
        ?.definition.ports.some((p) => p.id === l.targetPort)
        ? l.targetPort
        : "__page-in",
      style: {
        stroke: compatibleLink(project.workspace, l)
          ? l.dataType.includes("timeline")
            ? "#cbac77"
            : "#7cb6ad"
          : "#e07770",
        strokeDasharray: compatibleLink(project.workspace, l)
          ? undefined
          : "5 5",
      },
      label: compatibleLink(project.workspace, l) ? "信息" : "待重新连接",
    }));
  async function connect(c: Connection, replaceLinkId?: string) {
    const port = project.workspace.pages
      .find((n) => n.id === c.source)
      ?.definition.ports.find((p) => p.id === c.sourceHandle);
    if (port)
      await command({
        type: "information.connect",
        source: c.source,
        sourcePort: c.sourceHandle,
        target: c.target,
        targetPort: c.targetHandle,
        dataType: port.dataType,
        replace: true,
        replaceLinkId,
      });
  }
  async function autoConnect() {
    const links = autoConnections(project.workspace);
    if (!links.length) {
      notify("没有可唯一匹配的新连接；多个候选时请手动拉线。");
      return;
    }
    for (const l of links) await command({ type: "information.connect", ...l });
    notify(`已建立 ${links.length} 条信息连接。`);
  }
  async function saveTemplate() {
    try {
      await host.request("template.save", {
        projectId: project.id,
        name: templateName,
      });
      setSave(false);
      notify("工作流模板已保存。");
    } catch (e) {
      notify(String(e));
    }
  }
  const previewNode = project.workspace.pages.find(
    (n) => n.id === preview?.nodeId,
  );
  return (
    <section className="workspace-graph" aria-label="页面节点画布">
      <div className="graph-toolbar">
        <strong>信息连接</strong>
        <span className="graph-hint">
          拖动标题移动节点；从输出圆点拖到输入圆点
        </span>
        <div className="spacer" />
        {mode === "information" && (
          <Button onClick={autoConnect}>
            <WandSparkles size={14} />
            自动连接
          </Button>
        )}
        <IconButton label="收起节点画布" onClick={onClose}>
          <X size={17} />
        </IconButton>
      </div>
      <div className="graph-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          nodeDragThreshold={4}
          connectionDragThreshold={2}
          connectionRadius={24}
          connectOnClick={false}
          isValidConnection={(c) => {
            const source = project.workspace.pages
              .find((n) => n.id === c.source)
              ?.definition.ports.find((p) => p.id === c.sourceHandle);
            const target = project.workspace.pages
              .find((n) => n.id === c.target)
              ?.definition.ports.find((p) => p.id === c.targetHandle);
            return Boolean(
              source &&
              target &&
              source.direction === "output" &&
              target.direction === "input" &&
              source.dataType === target.dataType &&
              c.source !== c.target,
            );
          }}
          onNodesChange={onNodesChange}
          onNodeDragStop={(_, node) =>
            command({
              type: "workspace.configure",
              nodeId: node.id,
              position: node.position,
            })
          }
          onConnect={connect}
          onReconnect={(edge, connection) => {
            void connect(connection, edge.id);
          }}
          edgesReconnectable
          onEdgeDoubleClick={(_, edge) => {
            if (mode === "information")
              void command({ type: "information.disconnect", linkId: edge.id });
          }}
          onEdgesDelete={(edges) => {
            if (mode === "information")
              for (const e of edges)
                void command({ type: "information.disconnect", linkId: e.id });
          }}
          onNodeContextMenu={(event, node) => {
            event.preventDefault();
            setMenu({ nodeId: node.id, x: event.clientX, y: event.clientY });
          }}
          onPaneClick={() => setMenu(null)}
          fitView
          fitViewOptions={{ padding: 0.22, maxZoom: 1 }}
          minZoom={0.35}
          maxZoom={1.5}
          deleteKeyCode={["Backspace", "Delete"]}
          colorMode="dark"
        >
          <Background gap={20} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
        <div className="graph-legend">
          <span>
            <i className="assets-legend" />
            素材
          </span>
          <span>
            <i className="timeline-legend" />
            时间线
          </span>
          <span>
            {project.workspace.pages.length} 节点 ·{" "}
            {project.workspace.links.length} 信息连接
          </span>
        </div>
        {previewNode && (
          <div className="page-peek" role="region" aria-label="插件页面预览">
            <header>
              <Glyph name={previewNode.definition.icon} />
              <strong>{previewNode.definition.name}</strong>
              <span>
                {preview?.pinned ? (
                  <>
                    <Pin size={12} />
                    已固定
                  </>
                ) : (
                  "临时预览"
                )}
              </span>
              <IconButton label="关闭页面预览" onClick={() => setPreview(null)}>
                <X size={14} />
              </IconButton>
            </header>
            <PagePreview node={previewNode} />
            <p>{previewNode.definition.description}</p>
          </div>
        )}
      </div>
      {menu && (
        <div
          className="context-menu"
          role="menu"
          style={{
            left: Math.min(menu.x, window.innerWidth - 215),
            top: Math.min(menu.y, window.innerHeight - 120),
          }}
        >
          <button
            role="menuitem"
            onClick={() => {
              setReplaceId(menu.nodeId);
              setMenu(null);
            }}
          >
            <Replace size={15} />
            替换节点
          </button>
          <button
            role="menuitem"
            onClick={() => {
              void command({ type: "workspace.remove", nodeId: menu.nodeId });
              setMenu(null);
            }}
          >
            <Trash2 size={15} />
            移除页面并归档
          </button>
        </div>
      )}
      {replaceId && (
        <PagePicker replacing={replaceId} onClose={() => setReplaceId(null)} />
      )}{" "}
      {adding && <PagePicker onClose={() => setAdding(false)} />}{" "}
      {save && (
        <Modal
          title="保存工作流模板"
          subtitle="保存页面组合与连接，不包含素材和剪辑内容。"
          onClose={() => setSave(false)}
        >
          <div className="modal-body">
            <label>
              模板名称
              <input
                autoFocus
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                aria-label="模板名称"
              />
            </label>
          </div>
          <footer className="modal-footer">
            <Button onClick={() => setSave(false)}>取消</Button>
            <Button
              className="primary"
              disabled={!templateName.trim()}
              onClick={saveTemplate}
            >
              保存模板
            </Button>
          </footer>
        </Modal>
      )}
    </section>
  );
}

function PagePreview({ node }: { node: PageNodeModel }) {
  return (
    <div className={`mini-page mini-${node.definition.type}`}>
      <div className="mini-top" />
      <div className="mini-side">
        <i />
        <i />
        <i />
      </div>
      <div className="mini-content">
        <span />
        <span />
        <span />
        <span />
      </div>
      <div className="mini-monitor">
        <Glyph name={node.definition.icon} size={26} />
      </div>
      <div className="mini-bottom">
        <i />
        <i />
        <i />
      </div>
    </div>
  );
}

export function PagePicker({
  replacing,
  onClose,
}: {
  replacing?: string;
  onClose: () => void;
}) {
  const { project, plugins, command, notify } = useProject();
  const [tab, setTab] = useState("type");
  const [selected, setSelected] = useState<{
    plugin: PluginRecord;
    page: PageDefinition;
  } | null>(null);
  const [report, setReport] = useState<ReplacementReport | null>(null);
  const [busy, setBusy] = useState(false);
  const old = project.workspace.pages.find((n) => n.id === replacing);
  const candidates = plugins
    .filter((p) => p.enabled)
    .flatMap((plugin) =>
      plugin.manifest.pages.map((page) => ({ plugin, page })),
    )
    .filter(
      (c) =>
        !old ||
        ((tab === "type"
          ? c.page.type === old.definition.type
          : c.plugin.manifest.id === old.pluginId) &&
          !(
            c.plugin.manifest.id === old.pluginId &&
            c.page.id === old.definition.id &&
            c.plugin.manifest.version === old.pluginVersion
          )),
    );
  useEffect(() => {
    let alive = true;
    setReport(null);
    if (replacing && selected)
      host
        .request<ReplacementReport>("workspace.replacementReport", {
          projectId: project.id,
          nodeId: replacing,
          pluginId: selected.plugin.manifest.id,
          pageId: selected.page.id,
        })
        .then((r) => {
          if (alive) setReport(r);
        })
        .catch((e) => notify(e.message));
    return () => {
      alive = false;
    };
  }, [selected, replacing, project.revision]);
  async function apply() {
    if (!selected) return;
    setBusy(true);
    const result = await command({
      type: replacing ? "workspace.replace" : "workspace.add",
      nodeId: replacing,
      pluginId: selected.plugin.manifest.id,
      pageId: selected.page.id,
    });
    setBusy(false);
    if (result) onClose();
  }
  return (
    <Modal
      title={replacing ? "替换节点" : "添加页面"}
      subtitle={
        old
          ? `当前页面：${old.definition.name} · ${old.pluginId}`
          : "从已启用插件中选择页面。"
      }
      onClose={onClose}
    >
      {replacing && (
        <div className="picker-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === "type"}
            onClick={() => {
              setTab("type");
              setSelected(null);
            }}
          >
            同类型节点
          </button>
          <button
            role="tab"
            aria-selected={tab === "package"}
            onClick={() => {
              setTab("package");
              setSelected(null);
            }}
          >
            同插件包节点
          </button>
        </div>
      )}
      <div className="picker-list">
        {candidates.length ? (
          candidates.map((c) => (
            <button
              className={
                selected?.plugin.manifest.id === c.plugin.manifest.id &&
                selected.page.id === c.page.id
                  ? "selected"
                  : ""
              }
              key={`${c.plugin.manifest.id}/${c.page.id}`}
              onClick={() => setSelected(c)}
            >
              <div className="plugin-icon">
                <Glyph name={c.page.icon} />
              </div>
              <div>
                <strong>{c.page.name}</strong>
                <p>
                  {c.plugin.manifest.name} · {c.page.type}
                </p>
                <small>{c.page.description}</small>
              </div>
              <Check size={16} />
            </button>
          ))
        ) : (
          <p className="picker-empty">
            没有其他候选节点。可在插件市场安装提供此类页面的插件。
          </p>
        )}
      </div>
      {selected && (
        <div className="replacement-summary">
          {replacing ? (
            report ? (
              <>
                <p>
                  {report.connections.filter((c) => c.compatible).length} /{" "}
                  {report.connections.length} 条连接可以继续使用。
                </p>
                <small>未匹配连接保留，旧页面状态进入归档；可撤销恢复。</small>
              </>
            ) : (
              <p>正在检查兼容性…</p>
            )
          ) : (
            <p>
              <ExternalLink size={13} />
              新页面将加入页面条末尾。
            </p>
          )}
        </div>
      )}
      <footer className="modal-footer">
        <Button onClick={onClose}>取消</Button>
        <Button
          className="primary"
          disabled={!selected || busy || (!!replacing && !report)}
          onClick={apply}
        >
          {busy ? "处理中…" : replacing ? "确认替换" : "添加页面"}
        </Button>
      </footer>
    </Modal>
  );
}
