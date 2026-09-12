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

import { MODES, nearest, seatBlocker, seatWaiting } from "./modes.js";
import * as stats from "./deploy/stats.js";

const PORT = Number(process.env.PORT || 8080);
// Anyone holding this can see what the players cannot. Set HUDDLE_ROOM_KEY to pin it across restarts.
const ROOM_KEY = process.env.HUDDLE_ROOM_KEY || Math.random().toString(36).slice(2, 8);
const PUBLIC = join(import.meta.dirname, "public");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
const HEARTBEAT = 6000;

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
  players: new Map(),        // id -> {id, name, ws, alive, score, seat, placed}
  phase: "lobby",            // lobby | live | gap | over
  modeKey: "blindside",
  data: {},                  // whatever the current mode needs
  winner: null,
  headline: null,            // a mode's own last word, for co-op rounds nobody "wins"
  notice: "",                // one line shown to everyone, e.g. "ALPHA is out"
  records: {},               // mode key -> the room's best. Keys starting with _ never ship.
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
// Everyone with a live socket, placed or not. This is who the seat guard is waiting on.
const present = () => players().filter((p) => !p.gone && p.ws.readyState === 1);
const send = (ws, m) => ws.readyState === 1 && ws.send(JSON.stringify(m));

// The context handed to every mode. Modes never touch sockets or the wire format.
const ctx = {
  now,
  players,
  alive,
  get data() { return room.data; },
  get phase() { return room.phase; },
  get records() { return room.records; },
  seatOf: (p) => p.seat,
  /** Nearest player to a swipe angle, excluding the thrower. */
  towards: (from, angle) => nearest(alive(), from, angle),
  setRecord(key, value) { room.records[key] = value; return value; },
  notice(text) { room.notice = text; },
  eliminate(p, why) {
    if (p?.alive) { p.alive = false; room.notice = why || `${p.name} is out`; }
    else room.notice = why || room.notice;
    const left = alive();
    if (left.length <= 1) return finish(left[0] || null, null);
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
  /** `headline` lets a co-op mode have the last word on a round nobody won. */
  finishRound(winner, headline) { finish(winner, headline); },
  push: () => push(),
};

function finish(winner, headline) {
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
  room.headline = headline || null;
  push();
}

/**
 * Nobody in the room may share a name. The whole product is "aim at a person", and the phone
 * previews that person BY NAME — three players called Sam, or the four walk-ups who all tapped
 * Join without typing anything, make every throw a guess and the room screen unreadable.
 */
function uniqueName(raw) {
  const base = String(raw || "").trim().slice(0, 12) || "PLAYER";
  const taken = new Set(players().map((p) => p.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; n < 100; n++) {
    const tryName = `${base.slice(0, 10)} ${n}`;
    if (!taken.has(tryName.toLowerCase())) return tryName;
  }
  return base;
}

function startRound() {
  const m = mode();
  // Derived fresh, never stored: see seatBlocker in modes.js.
  if (seatBlocker(present(), mode().min)) { room.phase = "lobby"; return push(); }
  if (alive().length < m.min) { room.phase = "lobby"; room.notice = `need ${m.min}+ players`; return push(); }
  room.phase = "live";
  room.data = {};
  room.winner = null;
  room.headline = null;
  room.roundStartedAt = now();
  m.start(ctx);
  push();
}

function startGame(key) {
  if (MODES[key]) room.modeKey = key;
  for (const p of players()) { p.alive = true; p.score = 0; }
  room.notice = "";
  room.headline = null;
  startRound();
}

// ---- wire -------------------------------------------------------------------
// Internal bookkeeping lives in `records` under keys starting with an underscore — which
// direction Relay is running this round, and so on. It must never reach a phone: anything on the
// wire is one devtools tab away from being public, and a secret the client has is not a secret.
const publicRecords = () =>
  Object.fromEntries(Object.entries(room.records).filter(([k]) => !k.startsWith("_")));

function push() {
  const m = mode();
  const base = {
    t: "view", now: now(), phase: room.phase, mode: room.modeKey, modeName: m.name,
    notice: room.notice, winner: room.winner, records: publicRecords(),
    modes: Object.entries(MODES).map(([k, v]) => ({ key: k, name: v.name, min: v.min, blurb: v.blurb })),
    players: players().map((p) => ({ id: p.id, name: p.name, alive: p.alive, score: p.score, seat: p.seat, placed: !!p.placed })),
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
  if (room.phase === "over") {
    return room.headline
      ? { kind: "text", ...room.headline }
      : { kind: "text", big: room.winner || "nobody", title: "WINS", sub: room.notice };
  }
  if (room.phase === "gap") return { kind: "text", title: room.notice || "next round", sub: "hold on" };
  return {
    kind: "text", title: m.name,
    sub: players().length < m.min ? `need ${m.min}+ phones` : names || "waiting",
    lobby: true, seatPicker: true,
    seatNotice: seatBlocker(present(), mode().min) || seatWaiting(present()),
    seats: present().map((q) => ({ id: q.id, name: q.name, angle: q.seat, placed: !!q.placed, you: !!p && q.id === p.id })),
  };
}

const viewFor = (p) => (room.phase === "live" ? mode().view(ctx, p) : lobbyView(p));

setInterval(() => {
  if (room.phase !== "live") return;
  if (mode().tick(ctx, now())) { lastChange = now(); push(); }
  else if (now() - lastChange > (mode().wedgeMs || 45000)) {   // a wedged round is worse than a restarted one
    room.notice = "round reset";
    lastChange = now();
    startRound();
  }
}, 50);

const wss = new WebSocketServer({ server: http });

// A tab left open in another room answers no pings but keeps its socket half-open for minutes.
// Before the seat guard existed that was merely untidy; now it is a phone the whole room is
// waiting on to sit down, so the protocol-level heartbeat is load-bearing.
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.awake === false) { ws.terminate(); continue; }
    ws.awake = false;
    try { ws.ping(); } catch { ws.terminate(); }
  }
}, HEARTBEAT);

wss.on("connection", (ws, req) => {
  ws.awake = true;
  ws.on("pong", () => { ws.awake = true; });
  if (new URL(req.url, "http://x").searchParams.has("spectate")) {
    if (new URL(req.url, "http://x").searchParams.get("spectate") !== ROOM_KEY) {
      return ws.close(4003, "room key required");
    }
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
        // Join order decides nothing about where you sit. You are nowhere until you say so.
        me = { id: nextId++, token, name: uniqueName(msg.name), ws,
               alive: room.phase === "lobby", score: 0, seat: 0, placed: false, gone: false };
        room.players.set(me.id, me);
      }
      send(ws, { t: "hello", id: me.id });
      return push();
    }
    if (msg.t === "seat" && me) {          // players place themselves where they actually sit
      const angle = Number(msg.angle);
      if (!Number.isFinite(angle)) return;
      me.seat = Math.atan2(Math.sin(angle), Math.cos(angle));
      me.placed = true;
      return push();
    }
    if (!me) return;
    if (msg.t === "start") return startGame(msg.mode);
    if (msg.t === "reset") {
      clearTimeout(gapTimer);
      room.phase = "lobby"; room.data = {}; room.winner = null; room.headline = null;
      room.notice = "room reset";
      for (const p of players()) { p.alive = true; p.score = 0; }   // seats survive a reset
      lastChange = now();
      return push();
    }
    if (msg.t === "kickGhosts") {          // drop anyone whose socket is gone, right now
      for (const p of players()) if (p.gone || p.ws.readyState !== 1) room.players.delete(p.id);
      room.notice = "cleared";
      return push();
    }
    if (msg.t === "act" && room.phase === "live" && me.alive) {
      lastChange = now();          // a room that is playing is not a room that is wedged
      if (mode().act(ctx, me, msg)) push();
    }
  });
  ws.on("close", () => {
    if (!me || me.ws !== ws) return;       // an old socket closing after a rejoin is not a leave
    me.gone = true;
    setTimeout(() => {                     // grace period: phones drop sockets on screen lock
      if (!me.gone) return;
      room.players.delete(me.id);
      if (!room.players.size) { room.phase = "lobby"; room.winner = null; room.headline = null; }
      push();
    }, 9000);
    push();
  });
});

await stats.load();
http.listen(PORT, () => console.log(`room screen: http://localhost:${PORT}/room?key=${ROOM_KEY}
party engine on http://localhost:${PORT} — modes: ${Object.keys(MODES).join(", ")}`));
