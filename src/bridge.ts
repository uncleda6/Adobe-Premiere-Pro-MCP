import net from "net";
import { loadConfig } from "./config.js";

/*
 * Protocol 2 – the Premiere MCP Bridge PANEL owns the port; this process is a
 * plain client. Any number of MCP processes (Claude Desktop sessions, Claude
 * Code, Codex, other AIs) can be connected at the same time; the panel queues
 * their requests. Nothing here ever listens on a port, so there is nothing to
 * fight over.
 */

const PORT = loadConfig().port;
const DEFAULT_TIMEOUT_MS = Number(process.env.PPRO_MCP_TIMEOUT_MS) || 60_000;
const LONG_TIMEOUT_MS = 15 * 60_000; // exports, renders, transcription, imports
const LONG_RE = /export|render|encode|transcribe|import|proxy|scene|reframe|elevenlabs/i;
const CONNECT_TIMEOUT_MS = 3_000;
const CLIENT_NAME = `${process.env.PPRO_MCP_CLIENT_NAME || "mcp"}:${process.pid}`;

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout; fn: string };

let sock: net.Socket | null = null;
let helloOk = false;
let panelInfo: any = null;
let buf = "";
let connecting: Promise<boolean> | null = null;
let requestId = 0;
const pending = new Map<string, Pending>();
let pongWaiters: Array<(p: any) => void> = [];

function onLine(line: string) {
  if (!line.trim()) return;
  let m: any;
  try { m = JSON.parse(line); } catch { return; }
  if (m.type === "hello") { helloOk = true; panelInfo = m; return; }
  if (m.type === "pong") { const w = pongWaiters; pongWaiters = []; w.forEach((f) => f(m)); return; }
  const p = pending.get(String(m.id));
  if (!p) return;
  pending.delete(String(m.id));
  clearTimeout(p.timer);
  if (m.error) p.reject(new Error(String(m.error)));
  else p.resolve(m.result);
}

function dropSocket(reason: string) {
  const s = sock;
  sock = null;
  helloOk = false;
  buf = "";
  if (s) { try { s.destroy(); } catch {} }
  for (const [id, p] of pending) {
    clearTimeout(p.timer);
    p.reject(new Error(`Lost connection to the Premiere MCP Bridge panel (${reason}) while running ${p.fn}.`));
    pending.delete(id);
  }
  const w = pongWaiters; pongWaiters = []; w.forEach((f) => f(null));
}

function connect(): Promise<boolean> {
  if (sock && helloOk) return Promise.resolve(true);
  if (connecting) return connecting;
  connecting = new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (ok: boolean) => { if (!settled) { settled = true; connecting = null; resolve(ok); } };
    const s = net.createConnection({ host: "127.0.0.1", port: PORT });
    s.setEncoding("utf8");
    s.setNoDelay(true);
    s.setKeepAlive(true, 10_000);
    const t = setTimeout(() => { try { s.destroy(); } catch {} done(false); }, CONNECT_TIMEOUT_MS);
    s.on("connect", () => {
      sock = s;
      s.write(JSON.stringify({ type: "hello", client: CLIENT_NAME, protocol: 2 }) + "\n");
    });
    s.on("data", (chunk: string) => {
      buf += chunk;
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        onLine(line);
        if (helloOk && !settled) { clearTimeout(t); done(true); }
      }
      // A protocol-1 (old WebSocket) peer answers with HTTP – treat as "old bridge".
      if (!helloOk && buf.startsWith("HTTP/")) { clearTimeout(t); try { s.destroy(); } catch {} done(false); }
    });
    s.on("error", () => { clearTimeout(t); done(false); });
    s.on("close", () => { clearTimeout(t); if (sock === s) dropSocket("socket closed"); done(false); });
  });
  return connecting;
}

function ping(timeoutMs = 2_000): Promise<any> {
  return new Promise((resolve) => {
    if (!sock || !helloOk) return resolve(null);
    const t = setTimeout(() => resolve(null), timeoutMs);
    pongWaiters.push((p) => { clearTimeout(t); resolve(p); });
    try { sock.write(JSON.stringify({ type: "ping" }) + "\n"); } catch { clearTimeout(t); resolve(null); }
  });
}

const NOT_RUNNING =
  "Premiere Pro is not reachable. Make sure Premiere Pro is running; the MCP Bridge panel loads automatically " +
  "(Window > Extensions > MCP Bridge if it was closed). If the panel shows 'Port 8097 busy', an old MCP build is " +
  "still holding the port – run fix_pr_mcp.bat once.";

/** Connect (if needed) and report panel state. */
export async function ensureConnected(): Promise<boolean> {
  return connect();
}

export function isConnected(): boolean {
  return !!sock && helloOk && !sock.destroyed;
}

export function getPort(): number {
  return PORT;
}

export async function getBridgeStatus(): Promise<any> {
  const ok = await connect();
  if (!ok) return { connected: false, port: PORT, mode: "client", note: NOT_RUNNING };
  const p = await ping();
  return {
    connected: true, port: PORT, mode: "client", client: CLIENT_NAME,
    panel: panelInfo?.panel, protocol: panelInfo?.protocol,
    jsxReady: p?.ready, busy: p?.busy, current: p?.current, busyMs: p?.busyMs,
    queue: p?.queue, clients: p?.clients,
  };
}

export async function callPremiere(functionName: string, args: any[] = []): Promise<any> {
  if (!(await connect())) throw new Error(NOT_RUNNING);
  const timeoutMs = LONG_RE.test(functionName) ? LONG_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
  const id = `${process.pid}-${++requestId}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(async () => {
      if (!pending.has(id)) return;
      pending.delete(id);
      // Withdraw it if it is still waiting in the panel queue (do not run it later behind our back).
      try { sock?.write(JSON.stringify({ type: "cancel", id }) + "\n"); } catch {}
      const p = await ping();
      let why: string;
      if (!p) why = "the panel stopped answering (Premiere may be frozen)";
      else if (p.busy && p.current === functionName)
        why = `Premiere has been running ${functionName} for ${Math.round(p.busyMs / 1000)}s – it is probably blocked by a dialog box in Premiere; close it and retry`;
      else if (p.busy)
        why = `the panel is still busy with ${p.current} (${Math.round(p.busyMs / 1000)}s, queue ${p.queue}) – possibly a dialog box in Premiere`;
      else why = "no reply from ExtendScript";
      reject(new Error(`Timeout after ${Math.round(timeoutMs / 1000)}s waiting for Premiere Pro (${functionName}): ${why}.`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer, fn: functionName });
    try {
      sock!.write(JSON.stringify({ id, functionName, args }) + "\n");
    } catch (e: any) {
      clearTimeout(timer);
      pending.delete(id);
      reject(new Error(`Failed to send to Premiere: ${e.message}`));
    }
  });
}

export function toolResult(result: any) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
  };
}
