import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { CoreClient } from "../electron/core-client.mjs";

const core = new CoreClient();
const server = new McpServer({
  name: "creative-workstation",
  version: "0.1.0",
});
const projectId = z
  .string()
  .describe("Project ID returned by workstation_project_list");
const forward = (method) => async (params) => {
  try {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(await core.request(method, params)),
        },
      ],
    };
  } catch (error) {
    return { isError: true, content: [{ type: "text", text: String(error) }] };
  }
};
server.tool(
  "workstation_project_list",
  "List local projects without opening a UI.",
  {},
  forward("project.list"),
);
server.tool(
  "workstation_project_get",
  "Read the current revision, assets, timeline, page composition and information links.",
  { projectId },
  forward("project.get"),
);
server.tool(
  "workstation_asset_search",
  "Search assets. Text search works now; semantic search reports CAPABILITY_UNAVAILABLE until an Embedding implementation is installed.",
  {
    projectId,
    query: z.string(),
    mode: z.enum(["text", "semantic"]).default("text"),
    includeArchived: z.boolean().default(false),
  },
  forward("asset.search"),
);
server.tool(
  "workstation_project_command",
  "Explicitly apply one public project command as an undoable transaction. Fetch project_get first and use its revision. Information connections never run plugins.",
  {
    projectId,
    expectedRevision: z.number().int().nonnegative(),
    command: z
      .record(z.unknown())
      .describe(
        'Public command with a type, e.g. {type:"timeline.add",assetId,trackId:"v1"}. See docs/development/HOST_API.md.',
      ),
  },
  forward("project.command"),
);
server.tool(
  "workstation_plugins_list",
  "List installed page and capability contributions.",
  {},
  forward("plugin.list"),
);
server.tool(
  "workstation_media_plan",
  "Read a media execution plan. This does not execute a render.",
  { projectId },
  forward("media.plan"),
);
server.tool(
  "workstation_project_undo",
  "Undo one transaction, with optimistic revision checking.",
  { projectId, expectedRevision: z.number().int().nonnegative() },
  forward("project.undo"),
);
server.tool(
  "workstation_information_resolve",
  "Read a page input binding, including missing sources and explicitly published custom values. This never executes a plugin.",
  { projectId, nodeId: z.string() },
  forward("information.resolve"),
);
server.tool(
  "workstation_asset_import",
  "Import explicitly chosen local media files into an existing project. Copies or links files according to mode; requires the latest project revision.",
  {
    projectId,
    expectedRevision: z.number().int().nonnegative(),
    mode: z.enum(["link", "copy"]),
    files: z.array(
      z.object({
        path: z.string(),
        metadata: z.record(z.unknown()).optional(),
      }),
    ),
  },
  forward("asset.import"),
);
server.tool(
  "workstation_media_capabilities",
  "Probe the native GES runtime and installed encoding factories.",
  {},
  forward("media.capabilities"),
);
server.tool(
  "workstation_media_export",
  "Explicitly render a frozen project revision through GES to a new output path. Never overwrites an existing file.",
  {
    projectId,
    expectedRevision: z.number().int().nonnegative(),
    outputPath: z.string(),
    profile: z.enum(["mp4-h264", "webm-vp8"]).default("mp4-h264"),
  },
  forward("media.export"),
);
server.tool(
  "workstation_media_jobs",
  "Read durable render jobs, progress, output paths and errors.",
  { projectId },
  forward("media.jobs"),
);
server.tool(
  "workstation_media_cancel",
  "Cancel a render job and preserve any partial output.",
  { jobId: z.string() },
  forward("media.cancel"),
);
await server.connect(new StdioServerTransport());
process.stdin.on("end", () => core.close());
process.on("SIGINT", async () => {
  await server.close();
  core.close();
});
