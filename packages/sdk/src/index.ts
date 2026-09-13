export interface Port {
  id: string;
  label: string;
  dataType: string;
  direction: "input" | "output";
}
export interface OptionField {
  id: string;
  label: string;
  type: "boolean" | "select" | "number" | "text";
  default: unknown;
  min?: number;
  max?: number;
  choices?: { value: string; label: string }[];
}
export interface PageDefinition {
  id: string;
  name: string;
  type: string;
  icon: string;
  renderer: string;
  description: string;
  ports: Port[];
  options: OptionField[];
  preview?: string | null;
}
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  sdkVersion: number;
  author: string;
  description: string;
  category: string;
  icon: string;
  repository?: string | null;
  pages: PageDefinition[];
  capabilities: string[];
  themes: unknown[];
}
export interface PluginRecord {
  manifest: PluginManifest;
  enabled: boolean;
  builtin: boolean;
  directory: string | null;
  installedAt: number;
}
export interface PageNode {
  id: string;
  pluginId: string;
  pluginVersion: string;
  definition: PageDefinition;
  position: { x: number; y: number };
  expanded: boolean;
  config: Record<string, unknown>;
  privateState: unknown;
}
export interface InformationLink {
  id: string;
  source: string;
  sourcePort: string;
  target: string;
  targetPort: string;
  dataType: string;
}
export interface Workspace {
  pages: PageNode[];
  links: InformationLink[];
}
export interface Asset {
  id: string;
  revision: number;
  name: string;
  mediaType: string;
  sourceUri: string;
  projectPath: string | null;
  size: number;
  importedAt: number;
  archived: boolean;
  metadata: Record<string, unknown>;
}
export interface Clip {
  disabled?: boolean;
  color?: string | null;
  linkGroup?: string;
  id: string;
  assetId: string;
  name: string;
  trackId: string;
  startTicks: number;
  inTicks: number;
  durationTicks: number;
  extensions: Record<string, unknown>;
}
export interface Timeline {
  id: string;
  name: string;
  timebase: number;
  frameRate: { numerator: number; denominator: number };
  width: number;
  height: number;
  tracks: {
    id: string;
    name: string;
    kind: string;
    locked?: boolean;
    color?: string | null;
    muted?: boolean;
    solo?: boolean;
    disabled?: boolean;
  }[];
  clips: Clip[];
}
export interface ArchiveEntry {
  id: string;
  kind: string;
  label: string;
  archivedAt: number;
  data: unknown;
}
export interface Project {
  formatVersion: number;
  id: string;
  name: string;
  revision: number;
  createdAt: number;
  modifiedAt: number;
  workspace: Workspace;
  assets: Asset[];
  timeline: Timeline | null;
  archive: ArchiveEntry[];
  templateRef: string | null;
}
export interface ProjectView extends Project {
  directory: string;
  canUndo: boolean;
  canRedo: boolean;
}
export interface ProjectSummary {
  id: string;
  name: string;
  directory: string;
  modifiedAt: number;
  assetCount: number;
  pageCount: number;
  offline: boolean;
  error?: string;
}
export interface WorkflowTemplate {
  id: string;
  name: string;
  version: number;
  createdAt: number;
  workspace: Workspace;
}
export interface ReplacementReport {
  sameType: boolean;
  connections: { id: string; compatible: boolean; dataType: string }[];
  reusableOptions: string[];
  preservesOldState: boolean;
}
export interface FileEntry {
  name: string;
  path: string;
  directory: boolean;
  size: number;
}
export interface DirectoryListing {
  directory: string;
  parent: string;
  entries: FileEntry[];
  truncated: boolean;
}
export interface ResourceStatus {
  available: boolean;
  devices: { name: string; used: number; total: number }[];
  reason?: string;
}
export interface HostTransport {
  request<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T>;
}
export interface DesktopBridge extends HostTransport {
  prepareGpuPreview(): Promise<{ available: boolean; adapter?: string }>;
  onGpuStatus(callback: (status: Record<string, unknown>) => void): () => void;
  pathForFile(file: File): string;
  onChanged(callback: () => void): () => void;
}

// The public SDK depends on a transport, not Electron. MCP and iframe pages share Core methods.
export function createHost(transport: HostTransport) {
  return {
    request: <T = unknown>(
      method: string,
      params: Record<string, unknown> = {},
    ) => transport.request<T>(method, params),
    projects: {
      list: () => transport.request<ProjectSummary[]>("project.list"),
      get: (projectId: string) =>
        transport.request<ProjectView>("project.get", { projectId }),
      command: (
        project: Pick<Project, "id" | "revision">,
        command: Record<string, unknown>,
      ) =>
        transport.request<ProjectView>("project.command", {
          projectId: project.id,
          expectedRevision: project.revision,
          command,
        }),
    },
    plugins: { list: () => transport.request<PluginRecord[]>("plugin.list") },
    templates: {
      list: () => transport.request<WorkflowTemplate[]>("template.list"),
    },
  };
}

export function compatibleLink(
  workspace: Workspace,
  link: InformationLink,
): boolean {
  const source = workspace.pages
    .find((n) => n.id === link.source)
    ?.definition.ports.find(
      (p) => p.id === link.sourcePort && p.direction === "output",
    );
  const target = workspace.pages
    .find((n) => n.id === link.target)
    ?.definition.ports.find(
      (p) => p.id === link.targetPort && p.direction === "input",
    );
  return (
    !!source &&
    !!target &&
    source.dataType === target.dataType &&
    source.dataType === link.dataType
  );
}

export function autoConnections(
  workspace: Workspace,
): Omit<InformationLink, "id">[] {
  const proposed: Omit<InformationLink, "id">[] = [];
  for (const target of workspace.pages)
    for (const input of target.definition.ports.filter(
      (p) => p.direction === "input",
    )) {
      if (
        workspace.links.some(
          (l) =>
            l.target === target.id &&
            l.targetPort === input.id &&
            compatibleLink(workspace, l),
        )
      )
        continue;
      const candidates = workspace.pages
        .filter((n) => n.id !== target.id)
        .flatMap((n) =>
          n.definition.ports
            .filter(
              (p) => p.direction === "output" && p.dataType === input.dataType,
            )
            .map((p) => ({ node: n, port: p })),
        );
      // Only unambiguous matches are automatic; multiple candidates stay available for manual wiring.
      if (candidates.length === 1)
        proposed.push({
          source: candidates[0].node.id,
          sourcePort: candidates[0].port.id,
          target: target.id,
          targetPort: input.id,
          dataType: input.dataType,
        });
    }
  return proposed;
}
