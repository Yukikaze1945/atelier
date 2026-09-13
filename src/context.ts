import { createContext, useContext } from "react";
import type { ProjectView, PluginRecord } from "../packages/sdk/src";
export interface ProjectContextValue {
  project: ProjectView;
  plugins: PluginRecord[];
  command: (
    command: Record<string, unknown>,
  ) => Promise<ProjectView | undefined>;
  execute: (
    method: string,
    params: Record<string, unknown>,
  ) => Promise<ProjectView | undefined>;
  refresh: () => Promise<void>;
  notify: (message: string) => void;
  openPage: (nodeId: string) => void;
}
export const ProjectContext = createContext<ProjectContextValue | null>(null);
export function useProject() {
  const context = useContext(ProjectContext);
  if (!context) throw new Error("缺少项目上下文");
  return context;
}
