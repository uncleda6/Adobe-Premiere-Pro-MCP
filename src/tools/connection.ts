import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getBridgeStatus } from "../bridge.js";

export function registerConnectionTools(server: McpServer) {
  server.tool(
    "get_connection_status",
    "Check the connection to Premiere Pro's MCP Bridge panel (panel queue, busy state, number of connected AI clients)",
    {},
    async () => ({
      content: [{ type: "text" as const, text: JSON.stringify(await getBridgeStatus()) }],
    })
  );
}
