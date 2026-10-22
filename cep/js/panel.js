/* MCP Bridge – status panel (UI only). The real bridge runs in the hidden
 * "MCP Bridge Service" extension; this panel just connects to it like any
 * other client and shows what it is doing. Closing this panel is harmless. */
var cs = new CSInterface();
var PORT = 8097;
var SERVICE_ID = "com.mcp.premiere.bridge.service";
var req = (typeof require === "function") ? require : (window.cep_node && window.cep_node.require);
var net = req ? req("net") : null;
var sock = null, buf = "", lastOk = 0;

function $(id) { return document.getElementById(id); }
function show(cls, text) { var s = $("status"); s.className = cls; s.textContent = text; }

function render(st) {
  lastOk = Date.now();
  var n = st.clients.length;
  if (!st.listening) show("bad", "端口 " + PORT + " 被占用（旧版 MCP 进程？运行 fix_pr_mcp.bat）");
  else if (!st.ready) show("busy", "正在加载 ExtendScript 模块…");
  else if (st.busy) show(st.busyMs > 20000 ? "bad" : "busy",
      "执行中：" + st.current + " · " + Math.round(st.busyMs / 1000) + "s" + (st.busyMs > 20000 ? "（可能被 PR 弹窗挡住）" : ""));
  else show("ok", "就绪 · " + n + " 个 AI 已连接");
  $("info").innerHTML = "已连接：" + (n ? st.clients.join("、") : "无") + "<br>排队：" + st.queue + " · 服务版本：" + st.panel;
  var log = $("log"), atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 4;
  log.textContent = (st.log || []).join("\n");
  if (atBottom) log.scrollTop = log.scrollHeight;
}

function connect() {
  if (!net) { show("bad", "面板里的 Node.js 未启用（检查 manifest.xml）"); return; }
  if (sock) return;
  var s = net.createConnection({ host: "127.0.0.1", port: PORT });
  sock = s; buf = "";
  s.setEncoding("utf8");
  s.on("connect", function () { s.write(JSON.stringify({ type: "hello", client: "status-panel", ui: true }) + "\n"); });
  s.on("data", function (d) {
    buf += d; var i;
    while ((i = buf.indexOf("\n")) >= 0) {
      var line = buf.slice(0, i); buf = buf.slice(i + 1);
      try { var m = JSON.parse(line); if (m.type === "status") render(m); } catch (e) {}
    }
  });
  var gone = function () { if (sock === s) sock = null; };
  s.on("error", gone); s.on("close", gone);
}

setInterval(function () {
  if (!sock) connect();
  else { try { sock.write(JSON.stringify({ type: "status" }) + "\n"); } catch (e) { sock = null; } }
  if (Date.now() - lastOk > 4000) show("bad", "后台服务未运行（PR 启动时会自动开启；可点下方按钮手动启动）");
}, 1500);
connect();

$("restart").onclick = function () {
  show("busy", "正在重启后台服务…");
  // Ask CEP to (re)open the hidden service extension.
  try { cs.requestOpenExtension(SERVICE_ID, ""); } catch (e) {}
  if (sock) { try { sock.destroy(); } catch (e) {} sock = null; }
};
