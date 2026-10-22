/* MCP Bridge SERVICE (hidden Custom extension, starts with Premiere) – protocol 2.
 * The panel is the SERVER: it owns 127.0.0.1:8097 and every MCP process
 * (any Claude session, Claude Code, Codex, other AIs) connects to it as a
 * client. Requests from all clients are queued and run one at a time.
 * Needs CEP Node.js (enabled in CSXS/manifest.xml).
 */

var PANEL_BUILD = "cep-bridge-4-service";
var PORT = 8097;

var cs = new CSInterface();

var LOG = [];
function log(msg) {
  var line = "[" + new Date().toLocaleTimeString() + "] " + msg;
  LOG.push(line);
  if (LOG.length > 200) LOG.shift();
}

function setStatus(text, className) { /* hidden service – status is served to the UI panel via the "status" request */ }

function buildScript(functionName, args) {
  if (!/^[A-Za-z_$][\w$.]*$/.test(functionName)) throw new Error("invalid function name");
  var argsStr = args.map(function (a) {
    if (typeof a === "string") return JSON.stringify(a);
    if (a !== null && typeof a === "object") return JSON.stringify(a);
    return String(a);
  }).join(", ");
  return functionName + "(" + argsStr + ")";
}

function parseResult(result) {
  if (result === "EvalScript error." || result === "undefined") {
    return { error: result };
  }
  try {
    return JSON.parse(result);
  } catch (e) {
    return { value: result };
  }
}

// ---- JSX modules ----------------------------------------------------------
var jsxLoaded = false;

function loadJSX() {
  var extPath = cs.getSystemPath(SystemPath.EXTENSION);
  var jsxPath = (extPath + "/jsx").replace(/\\/g, "/");

  log("Testing ExtendScript engine...");
  cs.evalScript('"hello"', function (result) {
    log("evalScript test: [" + result + "]");
    if (result === "EvalScript error.") {
      log("ExtendScript engine not ready, retrying in 2s...");
      setTimeout(loadJSX, 2000);
      return;
    }
    var modules = [
      "json2-polyfill",
      "utils", "project", "sequence", "timeline", "effects",
      "markers", "audio", "export", "metadata", "captions",
      "graphics", "playback"
    ];
    var idx = 0;
    function loadNext() {
      if (idx >= modules.length) {
        log("All JSX modules loaded");
        jsxLoaded = true;
        return;
      }
      var mod = modules[idx];
      cs.evalScript('$.evalFile("' + jsxPath + '/' + mod + '.jsx")', function (r) {
        log((r === "EvalScript error." ? "Failed to load: " : "Loaded: ") + mod + ".jsx");
        idx++;
        loadNext();
      });
    }
    loadNext();
  });
}

// ---- Server ---------------------------------------------------------------
function startServer() {
  var bridge;
  try {
    // Resolve through the junction so the require works from the real cep folder.
    var req = (typeof require === "function") ? require
            : (window.cep_node && window.cep_node.require) ? window.cep_node.require : null;
    if (!req) throw new Error("require() is not available");
    var path = req("path");
    var fs = req("fs");
    var ext = cs.getSystemPath(SystemPath.EXTENSION).replace(/^file:\/+/, "");
    var real = ext;
    try { real = fs.realpathSync(decodeURI(ext)); } catch (e) {}
    bridge = req(path.join(real, "js", "bridge-server.cjs"));
  } catch (e) {
    setStatus("Node.js not available", "disconnected");
    log("Cannot start server: " + e.message + " — is CEP Node enabled in manifest.xml?");
    return;
  }
  bridge.startBridgeServer({
    port: PORT,
    panelBuild: PANEL_BUILD,
    evalScript: function (script, cb) { cs.evalScript(script, cb); },
    buildScript: buildScript,
    parseResult: parseResult,
    isReady: function () { return jsxLoaded; },
    log: log,
    getLog: function () { return LOG.slice(-80); },
    onStatus: function (s) {
      if (!s.listening) { setStatus("Port " + PORT + " busy – retrying", "connecting"); return; }
      var t = "Ready · " + s.clients + " client" + (s.clients === 1 ? "" : "s");
      if (s.busy) t += " · running " + s.current + (s.queue ? " (+" + s.queue + " queued)" : "");
      setStatus(t, s.clients ? "connected" : "connecting");
    }
  });
}

log("panel build: " + PANEL_BUILD);
startServer();
setTimeout(loadJSX, 1000);
