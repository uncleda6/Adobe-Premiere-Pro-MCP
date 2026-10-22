import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import "./bridge.js";
import { registerAllTools } from "./tools/index.js";

const server = new McpServer({
  name: "premiere-pro",
  version: "1.0.0",
});

registerAllTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[MCP] Premiere Pro MCP server running");
}

// ---- Orphan guard --------------------------------------------------------
// Claude Desktop does not always kill this process when a session ends, so
// stale instances pile up. Exit as soon as the client closes our stdin.
function exitSoon(reason: string) {
  console.error(`[MCP] exiting: ${reason}`);
  setTimeout(() => process.exit(0), 200);
}
process.stdin.on("end", () => exitSoon("stdin ended"));
process.stdin.on("close", () => exitSoon("stdin closed"));

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
