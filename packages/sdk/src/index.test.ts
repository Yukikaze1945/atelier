import { describe, it, expect } from "vitest";
import {
  autoConnections,
  compatibleLink,
  createHost,
  type Workspace,
  type PageNode,
} from "./index";
function node(
  id: string,
  direction: "input" | "output",
  dataType = "assets",
): PageNode {
  return {
    id,
    pluginId: "example.plugin",
    pluginVersion: "1",
    position: { x: 0, y: 0 },
    expanded: false,
    config: {},
    privateState: {},
    definition: {
      id,
      name: id,
      type: "example",
      icon: "layers",
      renderer: "index.html",
      description: "",
      options: [],
      ports: [{ id: "port", label: "port", dataType, direction }],
    },
  };
}
describe("information binding", () => {
  it("connects only a unique compatible source without calling a plugin", () => {
    const workspace: Workspace = {
      pages: [node("a", "output"), node("b", "input")],
      links: [],
    };
    expect(autoConnections(workspace)).toEqual([
      {
        source: "a",
        sourcePort: "port",
        target: "b",
        targetPort: "port",
        dataType: "assets",
      },
    ]);
  });
  it("leaves ambiguous candidates for manual wiring", () => {
    expect(
      autoConnections({
        pages: [node("a", "output"), node("b", "output"), node("c", "input")],
        links: [],
      }),
    ).toEqual([]);
  });
  it("does not overwrite an occupied input and retains incompatible connection records", () => {
    const workspace: Workspace = {
      pages: [node("a", "output"), node("b", "input")],
      links: [
        {
          id: "l",
          source: "a",
          sourcePort: "port",
          target: "b",
          targetPort: "port",
          dataType: "assets",
        },
      ],
    };
    expect(autoConnections(workspace)).toEqual([]);
    workspace.pages[1] = node("b", "input", "timeline");
    expect(compatibleLink(workspace, workspace.links[0])).toBe(false);
    expect(workspace.links.length).toBe(1);
  });
  it("Host SDK forwards the same revisioned operation through any transport", async () => {
    const calls: unknown[] = [];
    const transport = {
      request: async <T>(...args: unknown[]) => {
        calls.push(args);
        return {} as T;
      },
    };
    await createHost(transport).projects.command(
      { id: "p", revision: 8 },
      { type: "asset.archive", assetId: "a" },
    );
    expect(calls).toEqual([
      [
        "project.command",
        {
          projectId: "p",
          expectedRevision: 8,
          command: { type: "asset.archive", assetId: "a" },
        },
      ],
    ]);
  });
});
