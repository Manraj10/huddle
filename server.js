// Engine for phone party games.
//
// The one thing this engine does that a normal multiplayer server does not: every player is sent
// a DIFFERENT view of the same room. That is what makes hidden-information games possible, and
// every mode below is built out of it. A mode is ~40 lines of server code and zero client code,
// because the client renders whatever view it is handed.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { WebSocketServer } from "ws";

import { MODES } from "./modes.js";
import * as stats from "./deploy/stats.js";

const PORT = Number(process.env.PORT || 8080);
const PUBLIC = join(import.meta.dirname, "public");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

const http = createServer(async (req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  if (path === "/stats") {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    return res.end(JSON.stringify(stats.ticker()));
  }
  const file = path === "/" ? "index.html" : path === "/room" || path === "/room/" ? "room.html" : path.slice(1);
  const abs = normalize(join(PUBLIC, file));
  const root = PUBLIC.endsWith(sep) ? PUBLIC : PUBLIC + sep;
  if (abs !== PUBLIC && !abs.startsWith(root)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  try {
    const body = await readFile(abs);
    res.writeHead(200, { "content-type": TYPES[extname(abs)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(body);
  } catch { res.writeHead(404).end("not found"); }
});

// ---- room state -------------------------------------------------------------
const room = {
  players: new Map(),        // id -> {id, name, ws, alive, score, seat}
  phase: "lobby",            // lobby | live | gap | over
  modeKey: "blindside",
  data: {},                  // whatever the current mode needs
  winner: null,
  notice: "",                // one line shown to everyone, e.g. "ALPHA is out"
};
let nextId = 1;
let gapTimer = null;
let lastChange = Date.now();
const spectators = new Set();

const now = () => Date.now();
const mode = () => MODES[room.modeKey];
const players = () => [...room.players.values()];
// A phone whose socket is gone cannot hold a bomb or be thrown to, even during the rejoin
// grace window. Without this the round wedges the moment the holder's screen locks.
const alive = () => players().filter((p) => p.alive && !p.gone);
const send = (ws, m) => ws.readyState === 1 && ws.send(JSON.stringify(m));

function seats() {
  const list = players();
  list.forEach((p, i) => { p.seat = list.length ? (i / list.length) * 2 * Math.PI : 0; });
}

// The context handed to every mode. Modes never touch sockets or the wire format.
const ctx = {
  now,
  players,
  alive,
  get data() { return room.data; },
  get phase() { return room.phase; },
  seatOf: (p) => p.seat,
  /** Nearest player to a swipe angle, excluding the thrower. */
  towards(from, angle) {
    const others = alive().filter((p) => p.id !== from.id);
    if (!others.length) return null;
    return others.reduce((best, p) => {
      const d = Math.abs(Math.atan2(Math.sin(p.seat - angle), Math.cos(p.seat - angle)));
      return d < best.d ? { p, d } : best;
    }, { p: others[0], d: Infinity }).p;
  },
  eliminate(p, why) {
    if (p?.alive) { p.alive = false; room.notice = why || `${p.name} is out`; }
    else room.notice = why || room.notice;
    const left = alive();
    if (left.length <= 1) return finish(left[0] || null);
    stats.recordRound({
      mode: room.modeKey,
      playerCount: players().length,
      durationMs: now() - (room.roundStartedAt || now()),
      winner: null,
      names: players().map((p) => p.name),
      reactions: room.modeKey === "flash" && room.data?.taps
        ? Object.values(room.data.taps).filter((t) => typeof t === "number" && t > 0)
        : [],
    });
    room.phase = "gap";
    push();
    clearTimeout(gapTimer);
    gapTimer = setTimeout(() => startRound(), 2400);
  },
  award(p, n = 1) { if (p) p.score += n; },
  finishRound(winner) { finish(winner); },
  push: () => push(),
};

function finish(winner) {
  const reactions = [];
  if (room.modeKey === "flash" && room.data?.taps) {
    for (const t of Object.values(room.data.taps)) if (typeof t === "number" && t > 0) reactions.push(t);
  }
  stats.recordRound({
    mode: room.modeKey,
    playerCount: players().length,
    durationMs: now() - (room.roundStartedAt || now()),
    winner: winner ? winner.name : null,
    names: players().map((p) => p.name),
    reactions,
  });
  room.phase = "over";
  room.winner = winner ? winner.name : null;
  push();
}

function startRound() {
  const m = mode();
  if (alive().length < m.min) { room.phase = "lobby"; room.notice = `need ${m.min}+ players`; return push(); }
  room.phase = "live";
  room.data = {};
  room.winner = null;
  room.roundStartedAt = now();
  m.start(ctx);
  push();
}

function startGame(key) {
  if (MODES[key]) room.modeKey = key;
  for (const p of players()) { p.alive = true; p.score = 0; }
  room.notice = "";
  startRound();
}

// ---- wire -------------------------------------------------------------------
function push() {
  const m = mode();
  const base = {
    t: "view", now: now(), phase: room.phase, mode: room.modeKey, modeName: m.name,
    notice: room.notice, winner: room.winner,
    modes: Object.entries(MODES).map(([k, v]) => ({ key: k, name: v.name, min: v.min, blurb: v.blurb })),
    players: players().map((p) => ({ id: p.id, name: p.name, alive: p.alive, score: p.score, seat: p.seat })),
  };
  for (const p of players()) {
    if (p.gone) continue;
    send(p.ws, { ...base, you: { id: p.id, alive: p.alive, score: p.score }, view: viewFor(p) });
  }
  const spec = {
    ...base, spectator: true, ticker: stats.ticker(),
    view: room.phase === "live" ? m.spectate(ctx) : lobbyView(null),
  };
  for (const ws of spectators) send(ws, spec);
}

function lobbyView(p) {
  const m = mode();
  const names = players().map((q) => q.name).join(" · ");
  if (room.phase === "over") return { kind: "text", big: room.winner || "nobody", title: "WINS", sub: room.notice };
  if (room.phase === "gap") return { kind: "text", title: room.notice || "next round", sub: "hold on" };
  return { kind: "text", title: m.name, sub: players().length < m.min ? `need ${m.min}+ phones` : names || "waiting", lobby: true };
}

const viewFor = (p) => (room.phase === "live" ? mode().view(ctx, p) : lobbyView(p));

setInterval(() => {
  if (room.phase !== "live") return;
  if (mode().tick(ctx, now())) { lastChange = now(); push(); }
  else if (now() - lastChange > 45000) {   // a wedged round is worse than a restarted one
    room.notice = "round reset";
    lastChange = now();
    startRound();
  }
}, 50);

const wss = new WebSocketServer({ server: http });
wss.on("connection", (ws, req) => {
  if (new URL(req.url, "http://x").searchParams.has("spectate")) {
    spectators.add(ws);
    ws.on("message", (buf) => {
      let msg; try { msg = JSON.parse(buf); } catch { return; }
      if (msg.t === "ping") return send(ws, { t: "pong", c: msg.c, s: now() });
    });
    ws.on("close", () => spectators.delete(ws));
    return push();
  }
  let me = null;
  ws.on("message", (buf) => {
    let msg; try { msg = JSON.parse(buf); } catch { return; }
    if (msg.t === "ping") return send(ws, { t: "pong", c: msg.c, s: now() });
    if (msg.t === "join") {
      const token = String(msg.token || "").slice(0, 64);
      const back = token && [...room.players.values()].find((p) => p.token === token);
      if (back) { back.ws = ws; back.gone = false; me = back; }
      else {
        me = { id: nextId++, token, name: String(msg.name || "player").slice(0, 12), ws,
               alive: room.phase === "lobby", score: 0, seat: 0, gone: false };
        room.players.set(me.id, me);
        seats();
      }
      send(ws, { t: "hello", id: me.id });
      return push();
    }
    if (msg.t === "seat" && me) {          // players place themselves where they actually sit
      me.seat = Number(msg.angle) || 0;
      return push();
    }
    if (!me) return;
    if (msg.t === "start") return startGame(msg.mode);
    if (msg.t === "reset") {
      clearTimeout(gapTimer);
      room.phase = "lobby"; room.data = {}; room.winner = null; room.notice = "room reset";
      for (const p of players()) { p.alive = true; p.score = 0; }
      lastChange = now();
      return push();
    }
    if (msg.t === "kickGhosts") {          // drop anyone whose socket is gone, right now
      for (const p of players()) if (p.gone || p.ws.readyState !== 1) room.players.delete(p.id);
      seats(); room.notice = "cleared";
      return push();
    }
    if (msg.t === "act" && room.phase === "live" && me.alive) {
      if (mode().act(ctx, me, msg)) push();
    }
  });
  ws.on("close", () => {
    if (!me || me.ws !== ws) return;       // an old socket closing after a rejoin is not a leave
    me.gone = true;
    setTimeout(() => {                     // grace period: phones drop sockets on screen lock
      if (!me.gone) return;
      room.players.delete(me.id);
      if (!room.players.size) { room.phase = "lobby"; room.winner = null; }
      push();
    }, 9000);
    push();
  });
});

await stats.load();
http.listen(PORT, () => console.log(`party engine on http://localhost:${PORT} — modes: ${Object.keys(MODES).join(", ")}`));
