# Protocol 2: multi-client bridge and migration

## Source and scope

Published 2026-10-22 from the user's local Claude implementation. The source and CEP assets are copied without runtime changes. The Windows installer, pinned dependencies, earlier JSX fixes, upstream MIT license and historical validation report are retained. This is the PR bridge only; the separate After Effects file-queue bridge is not included.

## Architecture

`MCP client -> stdio MCP process -> TCP 127.0.0.1:8097 -> hidden CEP service -> ExtendScript`

The hidden `com.mcp.premiere.bridge.service` extension owns the TCP listener. `com.mcp.premiere.bridge.panel` is a status client. Both ship in the same CEP bundle. The service queues requests from multiple connections, performs one `evalScript` call at a time and returns results to the originating connection. Identical request IDs from different clients remain separate. Requests are not authenticated; use only trusted local clients on a trusted computer. This is a local code-execution bridge and must not be exposed through a network proxy or port forward.

Client messages are newline-delimited JSON: `hello`, `ping`, and `{id, functionName, args}`. The reply is `{id, result}` or `{id, error}`. `cancel` removes only that connection's waiting job with the specified ID. It cannot stop an already running Adobe operation. A disconnected connection's waiting work is dropped. The service has a 20-minute watchdog for an unreturned operation; dropping its tracking state does not prove the host stopped executing it.

## Upgrade

1. Save your work, close existing MCP client sessions and exit Premiere normally. Avoid killing all Node processes.
2. Update the checkout already referenced by your installed CEP junction, then run its installer. If moving checkouts, the installer deliberately stops on a conflicting junction; resolve its target explicitly after verifying it is a link. It does not delete an existing installation.
3. Ensure all MCP clients launch the newly built `dist/server.js`. Never pair a protocol-1 client with the protocol-2 service.
4. Restart Premiere and clients. Open the visible MCP Bridge status panel; use its service-start button if needed. The button requests that CEP open the hidden service; it is not a force restart of Premiere.
5. Check `get_connection_status`: `connected:true`, `mode:"client"`, `protocol:2`, panel `cep-bridge-4-service`, `jsxReady:true`. Read the project path before editing and validate a small project copy.

If port 8097 is occupied, inspect its owner with `Get-NetTCPConnection -LocalPort 8097 -State Listen` and `Get-Process -Id <OwningProcess>`. An old Node listener may need its owning session closed. Do not run the old machine-specific `fix_pr_mcp.bat` indiscriminately. That helper is not shipped in this repository. The service retries port binding while the conflict remains.

## Publication verification

- TypeScript build and the original five JSX regression cases.
- TCP tests with real local sockets and mocked `evalScript`: two-client serialization and result routing; cancellation isolation; disconnect cleanup; readiness gating and host errors; rejection of old HTTP/WebSocket traffic.
- The 11 copied runtime/CEP files are checked against the local Claude source before upload.
- No project, media, private configuration, local logs, Claude conversation or backup directory is included.

Premiere was not reachable during these publication checks. Tests do not establish hidden-service activation, CEP Node loading, real host editing, rendering, or modal-dialog recovery on another computer. Earlier PR 2023 host evidence remains in `VALIDATION.md`. The AE bridge's historical results are separate and are not evidence for this PR release.
