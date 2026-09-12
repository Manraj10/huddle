// Engine for phone party games.
//
// The one thing this engine does that a normal multiplayer server does not: every player is sent
// a DIFFERENT view of the same room. That is what makes hidden-information games possible, and
// every mode below is built out of it. A mode is ~40 lines of server code and zero client code,
// because the client renders whatever view it is handed.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { WebSocketServer } from "ws";

import { MODES } from "./modes.js";

const PORT = Number(process.env.PORT || 8080);
const PUBLIC = join(import.meta.dirname, "public");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

const http = createServer(async (req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  const file = path === "/" ? "index.html" : path.slice(1);
  try {
    const body = await readFile(join(PUBLIC, file));
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
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
const spectators = new Set();

const now = () => Date.now();
const mode = () => MODES[room.modeKey];
const players = () => [...room.players.values()];
const alive = () => players().filter((p) => p.alive);
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
    if (!p?.alive) return;
    p.alive = false;
    room.notice = why || `${p.name} is out`;
    const left = alive();
    if (left.length <= 1) finish(left[0] || null);
    else { room.phase = "gap"; push(); setTimeout(() => startRound(), 2400); }
  },
  award(p, n = 1) { if (p) p.score += n; },
  finishRound(winner) { finish(winner); },
  push: () => push(),
};

function finish(winner) {
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
    send(p.ws, { ...base, you: { id: p.id, alive: p.alive, score: p.score }, view: viewFor(p) });
  }
  const spec = { ...base, spectator: true, view: room.phase === "live" ? m.spectate(ctx) : lobbyView(null) };
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
  if (mode().tick(ctx, now())) push();     // a mode returns true when something changed
}, 50);

const wss = new WebSocketServer({ server: http });
wss.on("connection", (ws, req) => {
  if (new URL(req.url, "http://x").searchParams.has("spectate")) {
    spectators.add(ws);
    ws.on("close", () => spectators.delete(ws));
    return push();
  }
  let me = null;
  ws.on("message", (buf) => {
    let msg; try { msg = JSON.parse(buf); } catch { return; }
    if (msg.t === "ping") return send(ws, { t: "pong", c: msg.c, s: now() });
    if (msg.t === "join") {
      me = { id: nextId++, name: String(msg.name || "player").slice(0, 12), ws, alive: room.phase === "lobby", score: 0, seat: 0 };
      room.players.set(me.id, me);
      seats(); send(ws, { t: "hello", id: me.id }); return push();
    }
    if (!me) return;
    if (msg.t === "start") return startGame(msg.mode);
    if (msg.t === "act" && room.phase === "live" && me.alive) {
      if (mode().act(ctx, me, msg)) push();
    }
  });
  ws.on("close", () => {
    if (!me) return;
    room.players.delete(me.id);
    seats();
    mode().leave?.(ctx, me);
    push();
  });
});

http.listen(PORT, () => console.log(`party engine on http://localhost:${PORT} — modes: ${Object.keys(MODES).join(", ")}`));
