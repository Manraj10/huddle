#!/usr/bin/env node
// Smoke the Lane 3 surface: /room, /stats, spectator ping, ticker after a round.
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

const PORT = Number(process.env.PORT || 43123);
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = fileURLToPath(new URL("..", import.meta.url));

const child = spawn("node", ["server.js"], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT) },
  stdio: ["ignore", "pipe", "pipe"],
});
let out = "";
child.stdout.on("data", (b) => { out += b; process.stdout.write(b); });
child.stderr.on("data", (b) => { out += b; process.stderr.write(b); });

function fail(msg) {
  console.error("FAIL", msg);
  child.kill("SIGTERM");
  process.exit(1);
}

const wsOpen = (url) => new Promise((resolve, reject) => {
  const ws = new WebSocket(url);
  ws.on("open", () => resolve(ws));
  ws.on("error", reject);
});
const once = (ws, pred) => new Promise((resolve) => {
  const on = (buf) => {
    const m = JSON.parse(buf);
    if (pred(m)) { ws.off("message", on); resolve(m); }
  };
  ws.on("message", on);
});

try {
  for (let i = 0; i < 40 && !out.includes("party engine"); i++) await sleep(50);
  if (!out.includes("party engine")) fail("server did not start");

  const room = await fetch(`${BASE}/room`);
  if (!room.ok) fail(`/room ${room.status}`);
  const html = await room.text();
  if (!html.includes("?spectate") || !html.includes("qrcode")) fail("room.html missing spectate/qr");

  const stats0 = await (await fetch(`${BASE}/stats`)).json();
  if (typeof stats0.rounds !== "number") fail("stats shape");

  const spec = await wsOpen(`ws://127.0.0.1:${PORT}/?spectate`);
  spec.send(JSON.stringify({ t: "ping", c: Date.now() }));
  const pong = await Promise.race([
    once(spec, (m) => m.t === "pong"),
    sleep(1000).then(() => null),
  ]);
  if (!pong) fail("spectator ping not answered");

  const a = await wsOpen(`ws://127.0.0.1:${PORT}/`);
  const b = await wsOpen(`ws://127.0.0.1:${PORT}/`);
  a.send(JSON.stringify({ t: "join", name: "Ada", token: "a" }));
  b.send(JSON.stringify({ t: "join", name: "Ben", token: "b" }));
  await once(a, (m) => m.t === "hello");
  await once(b, (m) => m.t === "hello");
  const liveP = once(spec, (m) => m.t === "view" && m.phase === "live" && m.spectator);
  a.send(JSON.stringify({ t: "start", mode: "blindside" }));
  const live = await Promise.race([liveP, sleep(2000).then(() => null)]);
  if (!live) fail("no live spectator view");
  if (!live.ticker || !live.view?.map) fail("spectator live view missing ticker/map");
  if (!Array.isArray(live.view.map.players) || live.view.map.players.length < 2) fail("map players");

  console.log("OK room, stats, spectator ping, live map");
  spec.close(); a.close(); b.close();
  child.kill("SIGTERM");
  process.exit(0);
} catch (err) {
  fail(err.stack || err.message);
}
