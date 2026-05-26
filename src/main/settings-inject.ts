import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Source of the hook forwarder. claude runs this (via `node`) on each hook event,
 * passing the hook payload as JSON on stdin. It reads the local server port/token from
 * env vars we set on the claude process, then POSTs the payload to our server and exits
 * fast. It deliberately prints NOTHING and always exits 0, so it can never add a
 * permission decision or block/slow the session beyond the local round-trip.
 *
 * NOTE: kept as plain ES5-ish JS with no backticks / template literals so it can live
 * safely inside this template string.
 */
const FORWARDER_SRC = `'use strict';
var http = require('http');
var port = process.env.ORBIT_HOOK_PORT;
var token = process.env.ORBIT_HOOK_TOKEN || '';
var sessionId = process.env.ORBIT_SESSION_ID || '';
var event = process.argv[2] || 'unknown';
var body = '';
var done = false;
function exit() { if (!done) { done = true; try { process.exit(0); } catch (e) {} } }
setTimeout(exit, 1500);
process.stdin.setEncoding('utf8');
process.stdin.on('data', function (d) { body += d; });
process.stdin.on('error', send);
process.stdin.on('end', send);
function send() {
  if (!port) return exit();
  var data;
  try { data = JSON.parse(body); } catch (e) { data = { raw: body }; }
  var payload = JSON.stringify({ event: event, token: token, sessionId: sessionId, ts: Date.now(), data: data });
  var req = http.request({
    host: '127.0.0.1', port: Number(port), path: '/hook', method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(payload),
      'x-orbit-token': token
    },
    timeout: 1000
  }, function (res) { res.resume(); res.on('end', exit); });
  req.on('error', exit);
  req.on('timeout', function () { try { req.destroy(); } catch (e) {} exit(); });
  req.write(payload);
  req.end();
}
`

export interface InjectedSession {
  /** Path to the temp settings.json to pass via `claude --settings <path>`. */
  settingsPath: string
  /** Temp dir holding the settings + forwarder; delete on session end. */
  dir: string
}

/**
 * Writes a per-session temp dir containing the forwarder script and a settings.json
 * that wires every interesting hook to it. This is passed to claude via `--settings`,
 * which MERGES with the user's global settings (it never clobbers them).
 */
export function writeInjectedSession(): InjectedSession {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-'))
  const forwarder = path.join(dir, 'hook-forwarder.cjs')
  fs.writeFileSync(forwarder, FORWARDER_SRC, 'utf8')

  // `node "<abs path>" <EventName>` — JSON.stringify escapes the Windows backslashes.
  const cmd = (evt: string) => `node "${forwarder}" ${evt}`
  const entry = (evt: string, matcher?: string) => ({
    ...(matcher ? { matcher } : {}),
    hooks: [{ type: 'command', command: cmd(evt) }]
  })

  const settings = {
    hooks: {
      PreToolUse: [entry('PreToolUse', '*')],
      PostToolUse: [entry('PostToolUse', '*')],
      UserPromptSubmit: [entry('UserPromptSubmit')],
      SessionStart: [entry('SessionStart', 'startup|resume|clear')],
      Stop: [entry('Stop')],
      Notification: [entry('Notification')]
    }
  }

  const settingsPath = path.join(dir, 'settings.json')
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8')
  return { settingsPath, dir }
}

export function cleanupInjectedSession(session: InjectedSession | null): void {
  if (!session) return
  try {
    fs.rmSync(session.dir, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
}
