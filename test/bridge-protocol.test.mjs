import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { createRequire } from 'node:module';

const { startBridgeServer } = createRequire(import.meta.url)('../cep/js/bridge-server.cjs');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  const deadline = Date.now() + 4000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for bridge state');
    await pause(10);
  }
}
async function fixture(t, options = {}) {
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const executions = [];
  const bridge = startBridgeServer({
    port,
    buildScript: (fn, args) => `${fn}:${JSON.stringify(args)}`,
    parseResult: JSON.parse,
    evalScript: (script, callback) => executions.push({ script, callback }),
    ...options,
  });
  t.after(() => bridge.stop());
  await until(() => bridge.stats().listening);
  async function client(name) {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    t.after(() => socket.destroy());
    socket.setEncoding('utf8');
    socket.on('error', () => {});
    let buffer = '';
    const messages = [];
    socket.on('data', chunk => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        try { messages.push(JSON.parse(line)); } catch { messages.push({ raw: line }); }
      }
    });
    await once(socket, 'connect');
    const send = message => socket.write(JSON.stringify(message) + '\n');
    const read = async match => {
      await until(() => messages.some(match));
      return messages.splice(messages.findIndex(match), 1)[0];
    };
    send({ type: 'hello', client: name, protocol: 2 });
    assert.equal((await read(m => m.type === 'hello')).protocol, 2);
    return { socket, send, read };
  }
  return { bridge, executions, client };
}

test('two clients serialize execution and receive only their own responses, including identical IDs', async t => {
  const f = await fixture(t);
  const a = await f.client('client-a');
  const b = await f.client('client-b');
  a.send({ id: 'same-id', functionName: 'first', args: ['a'] });
  await until(() => f.executions.length === 1);
  b.send({ id: 'same-id', functionName: 'second', args: ['b'] });
  await until(() => f.bridge.stats().queue === 1);
  assert.equal(f.executions.length, 1);
  b.send({ type: 'ping' });
  const status = await b.read(m => m.type === 'pong');
  assert.equal(status.busy, true);
  assert.equal(status.current, 'first');
  assert.equal(status.clients, 2);
  f.executions[0].callback('{"owner":"a"}');
  assert.deepEqual((await a.read(m => m.id === 'same-id')).result, { owner: 'a' });
  await until(() => f.executions.length === 2);
  assert.equal(f.executions[1].script, 'second:["b"]');
  f.executions[1].callback('{"owner":"b"}');
  assert.deepEqual((await b.read(m => m.id === 'same-id')).result, { owner: 'b' });
});

test('cancel withdraws only the requesting client queued job', async t => {
  const f = await fixture(t);
  const a = await f.client('a');
  const b = await f.client('b');
  a.send({ id: 'active', functionName: 'hold' });
  await until(() => f.executions.length === 1);
  a.send({ id: 'shared', functionName: 'withdrawn' });
  b.send({ id: 'shared', functionName: 'retained' });
  await until(() => f.bridge.stats().queue === 2);
  a.send({ type: 'cancel', id: 'shared' });
  await until(() => f.bridge.stats().queue === 1);
  f.executions[0].callback('{}');
  await until(() => f.executions.length === 2);
  assert.equal(f.executions[1].script, 'retained:[]');
  f.executions[1].callback('{}');
  await b.read(m => m.id === 'shared');
  assert.equal(f.bridge.stats().queue, 0);
});

test('disconnect drops queued work without cancelling another client current job', async t => {
  const f = await fixture(t);
  const a = await f.client('a');
  const b = await f.client('b');
  a.send({ id: 'active', functionName: 'hold' });
  await until(() => f.executions.length === 1);
  b.send({ id: 'gone', functionName: 'mustNotRun' });
  await until(() => f.bridge.stats().queue === 1);
  b.socket.destroy();
  await until(() => f.bridge.stats().clients === 1);
  assert.equal(f.bridge.stats().queue, 0);
  f.executions[0].callback('{}');
  await a.read(m => m.id === 'active');
  assert.equal(f.executions.length, 1);
});

test('queued scripts wait for JSX readiness and forward host errors', async t => {
  let ready = false;
  const f = await fixture(t, { isReady: () => ready });
  const a = await f.client('a');
  a.send({ id: 'script', functionName: 'executeScript', args: ['app.version'] });
  await until(() => f.bridge.stats().queue === 1);
  assert.equal(f.executions.length, 0);
  ready = true;
  await until(() => f.executions.length === 1);
  assert.equal(f.executions[0].script, 'app.version');
  f.executions[0].callback('{"error":"Host rejected script"}');
  assert.equal((await a.read(m => m.id === 'script')).error, 'Host rejected script');
});

test('an old WebSocket client is rejected without executing a script', async t => {
  const f = await fixture(t);
  const a = await f.client('legacy');
  a.socket.write('GET / HTTP/1.1\r\nHost: localhost\r\n\r\n');
  assert.match((await a.read(m => m.raw?.startsWith('HTTP/'))).raw, /426/);
  assert.equal(f.executions.length, 0);
});
