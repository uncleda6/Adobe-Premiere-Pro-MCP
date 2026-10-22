# Premiere Pro MCP — PR 2023 Windows adaptation, protocol 2

[中文安装说明](README.zh-CN.md) · [Changes and validation](docs/VALIDATION.md) · [Upstream](https://github.com/antipaster/Adobe-Premiere-Pro-MCP)

This is a community adaptation of **antipaster/Adobe-Premiere-Pro-MCP**, retaining the upstream MIT license. It connects MCP clients such as Codex and Claude to Premiere through local Node.js processes and a TCP bridge inside a CEP extension.

Validated on **Windows, Premiere Pro 23.0.0 (build 63), Chinese UI, CEP 11.5.2**. Fixes cover CEP 11 loading, loopback binding, timeline razor timecode, clip enabled-state reporting and Chinese clip volume control. See the validation report for the tested scope; the upstream tool catalog is not a guarantee that every tool works.

## October 2026: Claude multi-client bridge update

This update publishes the local Claude implementation: a hidden CEP service owns the loopback TCP listener, while each MCP process connects as a client. Requests from multiple AI sessions run through one serialized queue. The visible panel displays clients, queue depth, current operation and service logs; closing it leaves the hidden service running. Timed-out requests are withdrawn while still queued; an already executing host operation cannot be cancelled this way. Export/render/import operations allow 15 minutes, other operations default to 60 seconds (`PPRO_MCP_TIMEOUT_MS`). MCP processes exit when their client closes stdin.

The Claude runtime source is preserved in this publication. Node regression tests cover the queue and transport with mocked ExtendScript execution; Premiere was not running during the 2026-10-22 publication checks. Earlier host editing/export evidence below applies to the original Windows adaptation. See [protocol and migration notes](docs/PROTOCOL2.md).

## Install on another Windows computer

1. Install Premiere Pro 2023 and Node.js 22+ with npm. An MCP client is also required.
2. Download or clone this repository into a permanent folder, for example `D:\Tools\PremiereMCP`. Do not move that folder after installation.
3. Double-click `install.bat`, or run `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1` from the repository folder.
4. Use the Codex command or MCP JSON printed by the installer. It uses paths from **your** computer. Check any existing `premiere-pro` configuration before replacing it. The installer does not edit client configuration.
5. Restart Premiere and the MCP client. The hidden service is configured to start with Premiere. Open **Window > Extensions > MCP Bridge** to inspect status; if the service is absent, use the panel's service-start button. `get_connection_status` should report `connected: true`, `mode: "client"`, `protocol: 2`, `jsxReady: true`. Ask the client to read Premiere's version and active sequence, then check a short edit/export in a project copy.

The installer uses `npm ci`, builds and runs regression tests before enabling unsigned CEP 11 extensions in the current user's registry and creating a CEP junction. Existing installations at another path are preserved and reported as a conflict. Administrative access is normally unnecessary. `-CheckOnly` performs a preflight without installing or modifying settings.

Default connection: `127.0.0.1:8097`, newline-delimited JSON over TCP. The hidden CEP service owns this port; multiple MCP client processes can share it. Update both the CEP extension and MCP build together. If upgrading from the old WebSocket bridge, close old MCP sessions before restarting Premiere. Do not mix protocol 1 and protocol 2. See the migration notes for diagnosing an occupied port. No cloud API key is needed for local editing; upstream ElevenLabs functions are optional. Keep any personal `config.json` out of version control.

## Development

```sh
npm ci
npm run build
npm test
```

Node tests use mocks for selected ExtendScript boundary cases; they do not replace tests inside Premiere. [The preserved upstream README](README.upstream.md) describes the inherited tool catalog. Its original installer and compatibility claims do not describe this adaptation.

## Limits

Other Premiere versions, macOS, all-track razor behavior, audio keyframes and the full inherited tool catalog have not been validated by this adaptation. Razor uses Premiere's undocumented QE API. Begin with a copy of a project and check actual timeline state and exported media.
