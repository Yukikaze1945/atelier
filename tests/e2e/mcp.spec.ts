import { test, expect } from "@playwright/test";
import { mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CoreClient } from "../../electron/core-client.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
test("MCP shares Core data, resolves information, rejects stale writes and reports missing semantic model", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "workstation-mcp-"));
  const dataDir = path.join(directory, "state");
  const core = new CoreClient({ dataDir });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(root, "scripts", "mcp.mjs")],
    env: { ...process.env, WORKSTATION_DATA_DIR: dataDir } as Record<
      string,
      string
    >,
    stderr: "pipe",
  });
  const client = new Client({ name: "workstation-acceptance", version: "1.0" });
  try {
    const project = await core.request("project.create", {
      parentDirectory: directory,
      name: "Agent 工程",
    });
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.some((t) => t.name === "workstation_asset_search")).toBe(
      true,
    );
    const listed = await client.callTool({
      name: "workstation_project_list",
      arguments: {},
    });
    expect(JSON.parse((listed.content as any)[0].text)[0].id).toBe(project.id);
    const file = path.join(directory, "海边 镜头.png");
    await writeFile(file, "fixture");
    const imported = await client.callTool({
      name: "workstation_asset_import",
      arguments: {
        projectId: project.id,
        expectedRevision: 0,
        mode: "link",
        files: [{ path: file }],
      },
    });
    expect(imported.isError).not.toBe(true);
    const view = await core.request("project.get", { projectId: project.id });
    expect(view.assets).toHaveLength(1);
    const search = await client.callTool({
      name: "workstation_asset_search",
      arguments: { projectId: project.id, query: "海边", mode: "text" },
    });
    expect(JSON.parse((search.content as any)[0].text).results[0].id).toBe(
      view.assets[0].id,
    );
    const resolve = await client.callTool({
      name: "workstation_information_resolve",
      arguments: { projectId: project.id, nodeId: view.workspace.pages[1].id },
    });
    const binding = JSON.parse((resolve.content as any)[0].text).bindings[0];
    expect(binding.status).toBe("available");
    expect(binding.value.assets[0].id).toBe(view.assets[0].id);
    const semantic = await client.callTool({
      name: "workstation_asset_search",
      arguments: { projectId: project.id, query: "海边", mode: "semantic" },
    });
    expect(semantic.isError).toBe(true);
    expect((semantic.content as any)[0].text).toContain(
      "CAPABILITY_UNAVAILABLE",
    );
    const stale = await client.callTool({
      name: "workstation_project_command",
      arguments: {
        projectId: project.id,
        expectedRevision: 0,
        command: { type: "project.rename", name: "stale" },
      },
    });
    expect(stale.isError).toBe(true);
    expect((stale.content as any)[0].text).toContain("REVISION_CONFLICT");
    expect(
      (await core.request("project.get", { projectId: project.id })).name,
    ).toBe("Agent 工程");
  } finally {
    await client.close();
    core.close();
  }
});
