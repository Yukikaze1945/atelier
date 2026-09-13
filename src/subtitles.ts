import type { ProjectView, PluginRecord } from "../packages/sdk/src";
export interface SubtitleLane {
  nodeId: string;
  name: string;
  timebase: number;
  cues: { id: string; startTicks: number; endTicks: number; text: string }[];
}
export function subtitleInputs(
  project: ProjectView,
  nodeId: string,
  plugins: PluginRecord[],
): SubtitleLane[] {
  return project.workspace.links
    .filter(
      (l) => l.target === nodeId && l.dataType === "workstation.subtitles@1",
    )
    .flatMap((l) => {
      const node = project.workspace.pages.find((n) => n.id === l.source);
      if (
        !node ||
        !plugins.some(
          (p) =>
            p.enabled &&
            p.manifest.id === node.pluginId &&
            p.manifest.version === node.pluginVersion,
        )
      )
        return [];
      const doc = (node.privateState as { outputs?: Record<string, unknown> })
        ?.outputs?.[l.sourcePort] as
        Omit<SubtitleLane, "nodeId" | "name"> | undefined;
      return doc && Array.isArray(doc.cues) && doc.timebase > 0
        ? [{ ...doc, nodeId: node.id, name: node.definition.name }]
        : [];
    });
}
