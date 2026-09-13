import { useCallback, useEffect, useRef } from "react";
import type { PageNode } from "../../packages/sdk/src";
import { useProject } from "../context";
import { host } from "../host";

export function PluginPage({ node }: { node: PageNode }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const { project, refresh, notify } = useProject();
  const src = `workstation-plugin://${node.pluginId}/${node.definition.renderer}`;
  const latest = useRef(project);
  latest.current = project;
  const publish = useCallback(async () => {
    const snapshot = latest.current;
    try {
      const information = await host.request("information.resolve", {
        projectId: snapshot.id,
        nodeId: node.id,
      });
      if (latest.current.revision !== snapshot.revision) return;
      frame.current?.contentWindow?.postMessage(
        {
          type: "workstation.context",
          sdkVersion: 1,
          nodeId: node.id,
          project: snapshot,
          information,
        },
        "*",
      );
    } catch (error) {
      notify(String(error));
    }
  }, [node.id, notify]);
  useEffect(() => {
    void publish();
  }, [project, publish]);
  useEffect(() => {
    const listener = async (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const message = event.data;
      if (
        !message ||
        message.type !== "workstation.request" ||
        typeof message.method !== "string"
      )
        return;
      if (message.method === "context.get") {
        publish();
        return;
      }
      try {
        const result = await host.request(message.method, message.params || {});
        frame.current?.contentWindow?.postMessage(
          { type: "workstation.response", id: message.id, result },
          "*",
        );
        await refresh();
      } catch (error) {
        frame.current?.contentWindow?.postMessage(
          {
            type: "workstation.response",
            id: message.id,
            error: String(error),
          },
          "*",
        );
      }
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [project.id, node.id, refresh, publish]);
  return (
    <iframe
      ref={frame}
      title={node.definition.name}
      className="plugin-frame"
      src={src}
      onLoad={publish}
      onError={() => notify("插件页面加载失败，节点和工程数据已保留。")}
    />
  );
}
