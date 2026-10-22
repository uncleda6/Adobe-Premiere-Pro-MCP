/*
 * MCP Bridge – panel-side server (runs inside the CEP panel's Node.js context).
 *
 * Architecture (protocol 2): the Premiere panel OWNS the port; every MCP server
 * process (Claude Desktop sessions, Claude Code, Codex, other AIs ...) connects
 * to it as a client. Many clients can be connected at once; their requests are
 * queued and executed one at a time through CSInterface.evalScript, so nobody
 * has to fight over the port any more.
 *
 * Wire format: newline-delimited JSON over TCP on 127.0.0.1:<port>.
 *   client -> panel  {"type":"hello","client":"claude-desktop:1234"}
 *                    {"type":"ping"}
 *                    {"id":"7","functionName":"getProjectInfo","args":[]}
 *   panel  -> client {"type":"hello","protocol":2,"panel":"...","queue":0}
 *                    {"type":"pong","busy":true,"current":"exportSequence","busyMs":12000,"queue":2,"clients":3}
 *                    {"id":"7","result":{...}}  or  {"id":"7","error":"..."}
 */
var net = require("net");

var PROTOCOL = 2;
var JOB_MAX_MS = 20 * 60 * 1000; // abandon a job that never returns, so the queue cannot stay stuck forever

function startBridgeServer(opts) {
  var port = opts.port || 8097;
  var evalScript = opts.evalScript;          // function(script, cb(resultString))
  var buildScript = opts.buildScript;        // function(functionName, args) -> script string
  var parseResult = opts.parseResult;        // function(resultString) -> object
  var log = opts.log || function () {};
  var onStatus = opts.onStatus || function () {};
  var isReady = opts.isReady || function () { return true; };
  var panelBuild = opts.panelBuild || "?";
  var getLog = opts.getLog || function () { return []; };

  var clients = [];          // { sock, name, buf }
  var queue = [];            // { client, id, functionName, args, enq }
  var current = null;        // job in flight
  var server = null;
  var listening = false;

  function status() {
    onStatus({ listening: listening, clients: clients.length, queue: queue.length, busy: !!current,
               current: current ? current.functionName : null });
  }

  function send(client, obj) {
    if (!client || client.sock.destroyed) return;
    try { client.sock.write(JSON.stringify(obj) + "\n"); } catch (e) {}
  }

  function pump() {
    if (current || !queue.length) return;
    if (!isReady()) { setTimeout(pump, 300); return; }   // JSX modules still loading
    var job = queue.shift();
    if (job.client.sock.destroyed) { pump(); return; }    // caller went away
    current = job; current.started = Date.now();
    status();
    var script;
    try {
      script = job.functionName === "executeScript" ? String(job.args[0]) : buildScript(job.functionName, job.args || []);
    } catch (e) {
      finish(job, { error: "Bad request: " + e.message });
      return;
    }
    log("← " + job.client.name + " " + job.functionName + " #" + job.id);
    job.watchdog = setTimeout(function () {
      log("Job " + job.functionName + " #" + job.id + " exceeded " + (JOB_MAX_MS / 60000) + " min – abandoning it");
      finish(job, { error: "Abandoned by the panel after " + (JOB_MAX_MS / 60000) + " minutes without a reply from ExtendScript" });
    }, JOB_MAX_MS);
    evalScript(script, function (res) { finish(job, parseResult(res)); });
  }

  function finish(job, result) {
    if (current !== job) return;
    current = null;
    clearTimeout(job.watchdog);
    var msg = { id: job.id };
    if (result && result.error) msg.error = result.error; else msg.result = result;
    send(job.client, msg);
    log("→ " + job.client.name + " #" + job.id + " (" + (Date.now() - job.started) + "ms)");
    status();
    setTimeout(pump, 0);
  }

  function onLine(client, line) {
    if (client.rejected || !line.trim()) return;
    var m;
    try { m = JSON.parse(line); } catch (e) {
      // Not our protocol (e.g. a protocol-1 MCP build sending an HTTP/WebSocket upgrade).
      client.rejected = true;
      log("Rejected non-protocol-2 client " + client.name + " (old MCP build?)");
      try { client.sock.end("HTTP/1.1 426 Upgrade Required\r\nContent-Length: 0\r\n\r\n"); } catch (e2) {}
      return;
    }
    if (m.type === "hello") {
      if (m.client) client.name = String(m.client).slice(0, 60);
      client.isUi = !!m.ui;
      send(client, { type: "hello", protocol: PROTOCOL, panel: panelBuild, queue: queue.length, ready: isReady() });
      if (!client.isUi) log("Client hello: " + client.name);
      status();
      return;
    }
    if (m.type === "ping") {
      send(client, { type: "pong", ready: isReady(), busy: !!current, current: current ? current.functionName : null,
                     busyMs: current ? Date.now() - current.started : 0, queue: queue.length,
                     clients: clients.filter(function (c) { return !c.isUi; }).length });
      return;
    }
    if (m.type === "status") {
      send(client, { type: "status", panel: panelBuild, listening: listening, ready: isReady(), busy: !!current,
                     current: current ? current.functionName : null, currentClient: current ? current.client.name : null,
                     busyMs: current ? Date.now() - current.started : 0, queue: queue.length,
                     clients: clients.filter(function (c) { return !c.isUi; }).map(function (c) { return c.name; }),
                     log: getLog() });
      return;
    }
    if (m.type === "cancel") {
      var before = queue.length;
      queue = queue.filter(function (j) { return !(j.client === client && j.id === String(m.id)); });
      if (queue.length !== before) log("Cancelled queued #" + m.id + " for " + client.name);
      status();
      return;
    }
    if (m.id !== undefined && m.functionName) {
      queue.push({ client: client, id: String(m.id), functionName: String(m.functionName), args: m.args || [], enq: Date.now() });
      status();
      pump();
    }
  }

  function onConnection(sock) {
    var client = { sock: sock, name: sock.remoteAddress + ":" + sock.remotePort, buf: "" };
    clients.push(client);
    sock.setEncoding("utf8");
    sock.setNoDelay(true);
    sock.on("data", function (chunk) {
      client.buf += chunk;
      var i;
      while ((i = client.buf.indexOf("\n")) >= 0) {
        var line = client.buf.slice(0, i);
        client.buf = client.buf.slice(i + 1);
        onLine(client, line);
      }
      if (client.buf.length > 50 * 1024 * 1024) { log("Client buffer overflow, dropping " + client.name); sock.destroy(); }
    });
    var gone = function () {
      var k = clients.indexOf(client);
      if (k >= 0) { clients.splice(k, 1); if (!client.isUi) log("Client left: " + client.name); }
      // drop its queued (not yet started) jobs
      queue = queue.filter(function (j) { return j.client !== client; });
      status();
    };
    sock.on("close", gone);
    sock.on("error", function () {});
    status();
  }

  function listen() {
    server = net.createServer(onConnection);
    server.on("error", function (err) {
      listening = false;
      status();
      if (err && err.code === "EADDRINUSE") {
        log("Port " + port + " is in use (an old MCP build may still be running). Retrying...");
      } else {
        log("Server error: " + (err && err.message));
      }
      try { server.close(); } catch (e) {}
      setTimeout(listen, 3000);
    });
    server.listen(port, "127.0.0.1", function () {
      listening = true;
      log("Listening on 127.0.0.1:" + port + " (protocol " + PROTOCOL + ")");
      status();
    });
  }

  listen();
  return {
    stop: function () { try { server.close(); } catch (e) {} clients.forEach(function (c) { c.sock.destroy(); }); },
    stats: function () { return { listening: listening, clients: clients.length, queue: queue.length, current: current && current.functionName }; }
  };
}

module.exports = { startBridgeServer: startBridgeServer, PROTOCOL: PROTOCOL };
