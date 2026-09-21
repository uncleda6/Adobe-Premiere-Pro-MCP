# Premiere Pro MCP — PR 2023 Windows adaptation

[中文安装说明](README.zh-CN.md) · [Changes and validation](docs/VALIDATION.md) · [Upstream](https://github.com/antipaster/Adobe-Premiere-Pro-MCP)

This is a community adaptation of **antipaster/Adobe-Premiere-Pro-MCP**, retaining the upstream MIT license. It connects an MCP client such as Codex to Premiere through a local Node.js server, a WebSocket bridge and a CEP extension.

Validated on **Windows, Premiere Pro 23.0.0 (build 63), Chinese UI, CEP 11.5.2**. Fixes cover CEP 11 loading, loopback binding, timeline razor timecode, clip enabled-state reporting and Chinese clip volume control. See the validation report for the tested scope; the upstream tool catalog is not a guarantee that every tool works.

## Install on another Windows computer

1. Install Premiere Pro 2023 and Node.js 22+ with npm. An MCP client is also required.
2. Download or clone this repository into a permanent folder, for example `D:\Tools\PremiereMCP`. Do not move that folder after installation.
3. Double-click `install.bat`, or run `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1` from the repository folder.
4. Use the Codex command or MCP JSON printed by the installer. It uses paths from **your** computer. Check any existing `premiere-pro` configuration before replacing it. The installer does not edit client configuration.
5. Restart Premiere and the MCP client, then open **Window > Extensions > MCP Bridge**. Ask the client to read Premiere's version and active sequence. A green Connected label alone does not validate editing or export.

The installer uses `npm ci`, builds and runs regression tests before enabling unsigned CEP 11 extensions in the current user's registry and creating a CEP junction. Existing installations at another path are preserved and reported as a conflict. Administrative access is normally unnecessary. `-CheckOnly` performs a preflight without installing or modifying settings.

Default connection: `127.0.0.1:8097`. Use one server instance per port. No cloud API key is needed for local editing; upstream ElevenLabs functions are optional. Keep any personal `config.json` out of version control.

## Development

```sh
npm ci
npm run build
npm test
```

Node tests use mocks for selected ExtendScript boundary cases; they do not replace tests inside Premiere. [The preserved upstream README](README.upstream.md) describes the inherited tool catalog. Its original installer and compatibility claims do not describe this adaptation.

## Limits

Other Premiere versions, macOS, all-track razor behavior, audio keyframes and the full inherited tool catalog have not been validated by this adaptation. Razor uses Premiere's undocumented QE API. Begin with a copy of a project and check actual timeline state and exported media.
