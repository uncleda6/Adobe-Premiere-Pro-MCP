# Premiere Pro MCP：PR 2023 Windows 适配版（protocol 2）

基于 [antipaster/Adobe-Premiere-Pro-MCP](https://github.com/antipaster/Adobe-Premiere-Pro-MCP) 修改，保留上游 MIT 许可证和归属。让 Codex 等 MCP 客户端通过本地服务控制 Premiere。

已实测：**Windows、Premiere Pro 23.0.0（build 63）、中文界面、CEP 11.5.2**。完成过导入、创建序列、切割、删除与移动片段、调节片段音量、保存和直接导出。完整范围见 [修复与实测记录](docs/VALIDATION.md)。

## 2026 年 10 月：Claude 多客户端桥接更新

本次发布本机 Claude 优化后的源码：由 PR 内隐藏的 CEP 服务监听端口，各 AI 的 MCP 进程作为客户端连接。多个会话的请求统一排队、逐个执行，避免每个会话抢占同一个端口。可见面板显示客户端、队列、运行中的操作和日志，关闭状态面板不会关闭隐藏服务。

普通请求默认等待 60 秒（可通过 `PPRO_MCP_TIMEOUT_MS` 配置），导出、渲染、导入等操作等待 15 分钟；超时会撤销尚未开始的排队请求，不能中断已经执行的 PR 操作。客户端关闭输入流后，MCP 进程会退出。

发布副本保留 Claude 的运行时代码。新增自动回归检查模拟 ExtendScript 执行，验证多客户端队列；2026-10-22 发布检查时 PR 未运行，没有重做新版的 PR 内剪辑和导出实测。上面的剪辑实测来自早期 Windows 适配版。详见 [升级与协议说明](docs/PROTOCOL2.md)。

## 在另一台电脑安装

1. 准备 Premiere Pro 2023、带 npm 的 Node.js 22 或更新版本，以及 Codex 或其他支持 MCP 的客户端。安装 Node 后重新打开终端。
2. 下载本仓库 ZIP 并解压到长期保留的目录，例如 `D:\Tools\PremiereMCP`。不要从 ZIP 内直接运行，也不要装完后移动目录。
3. 双击 `install.bat`。也可在该目录打开 PowerShell，执行：

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1
   ```

4. 安装脚本会输出适用于当前电脑的 `codex mcp add premiere-pro -- ...` 命令，以及其他 MCP 客户端可用的 JSON。按你使用的客户端注册一次。已有同名配置时先核对，脚本不会自动覆盖。
5. 重启 PR 与 MCP 客户端。隐藏服务配置为随 PR 启动；在 **窗口 → 扩展 → MCP Bridge** 打开状态面板，服务没启动时使用面板中的启动按钮。`get_connection_status` 应返回 `connected:true`、`mode:"client"`、`protocol:2`、`jsxReady:true`。先读取 PR 版本和当前序列，再用测试工程尝试剪辑和导出。

如果只有 Codex 桌面应用、没有 `codex` 命令，在客户端的 MCP 设置中按脚本输出的 `command` 和 `args` 添加本地服务。命令是 Node 的完整路径，参数是当前仓库的 `dist/server.js` 完整路径；不要复制别人的电脑路径。

## 安装脚本会做什么

- 检查 Node/npm、文件完整性以及是否存在冲突的 CEP 安装。
- 按 `package-lock.json` 执行 `npm ci`，编译并运行回归测试。
- 将当前用户的 `HKCU\Software\Adobe\CSXS.11\PlayerDebugMode` 设为字符串 `1`，允许加载未签名的 CEP 11 扩展。
- 在 `%APPDATA%\Adobe\CEP\extensions\com.mcp.premiere.bridge` 创建指向本仓库 `cep` 的目录联接。
- 输出客户端配置，不自动改写 Codex、Claude 或其他客户端的设置。

通常不需要管理员权限。预检查可以添加 `-CheckOnly`，不会安装依赖或改动注册表和链接。

如果已有扩展链接到另一个目录，脚本会停止并显示路径。可继续使用旧目录中的安装；确需迁移时，先核对旧扩展是目录联接并妥善处理，再重新安装，脚本不会删除已有目录。

## 连接与故障排查

- 默认使用 `127.0.0.1:8097` 的 TCP 行分隔 JSON 协议。PR 内的隐藏 CEP 服务占用端口，多个 MCP 客户端共享它。
- 升级时同时更新 CEP 扩展与 MCP 编译文件。旧版使用 WebSocket，新旧协议不能混用；先关闭旧 MCP 会话，再重启 PR 和客户端。不要直接运行旧的批处理来批量结束所有 MCP 进程；先查明端口由哪个进程监听，详见升级说明。
- `Connected` 仅代表桥接连通。通过读取版本、实际时间线变化和短片导出判断功能是否正常。
- 面板缺失：确认 PR 是 2023、安装成功且已重启；本脚本仅设置 CEP 11，不保证其他版本。
- 导出需要本机可用的 Premiere 编码预设，不能照搬另一台电脑的 `.epr` 路径。
- 本地剪辑不需要 ElevenLabs Key。可选配音功能来自上游；如需配置，从 `config.example.json` 复制到 `config.json`，不要提交个人密钥。

## 开发与适用范围

```powershell
npm ci
npm run build
npm test
```

自动测试对部分 ExtendScript 接口进行模拟，不会操作 PR。其他 PR 版本、macOS、整条时间线一键切割、音频关键帧和全部上游工具尚未逐一实测。切割依赖非公开 QE API，建议先用工程副本验证。

上游原始介绍保存在 [README.upstream.md](README.upstream.md)，其中旧安装方式和兼容性描述不作为本适配版的测试结论。
