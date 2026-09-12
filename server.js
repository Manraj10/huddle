// Blindside — the charge lives on exactly one phone at a time, and nobody can see
// where it is except the person holding it. Server is authoritative about everything.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT || 8080);
const PUBLIC = join(import.meta.dirname, "public");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

const FLIGHT = 700;        // ms the charge is invisible between two phones
const CATCH_LOCK = 450;    // ms you must hold it before you can pass it on
const FUSE = [14000, 26000];

const http = createServer(async (req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  const file = path === "/" ? "index.html" : path.slice(1);
  try {
    const body = await readFile(join(PUBLIC, file));
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(body);
  } catch { res.writeHead(404).end("not found"); }
});

const wss = new WebSocketServer({ server: http });
const players = new Map();           // id -> {id, name, alive, seat, ws, lastSeen}
let phase = "lobby";                 // lobby | live | over
let holder = null, flight = null, fuseAt = 0, lockUntil = 0, winner = null, lastBoom = null;
let nextId = 1;

const now = () => Date.now();
const alive = () => [...players.values()].filter((p) => p.alive);
const send = (ws, msg) => ws.readyState === 1 && ws.send(JSON.stringify(msg));
const broadcast = (msg) => { for (const p of players.values()) send(p.ws, msg); };

function seats() {
  // Everyone gets an angle around a circle so a swipe direction can mean a person.
  const list = [...players.values()];
  list.forEach((p, i) => { p.seat = list.length ? (i / list.length) * 2 * Math.PI : 0; });
}

function stateFor(p) {
  return {
    t: "state", phase, now: now(),
    you: p ? { id: p.id, alive: p.alive, holding: holder === p.id, lockUntil } : null,
    fuseAt: phase === "live" ? fuseAt : 0,
    // Players are told WHO is playing, never where the charge is. That is the whole game.
    players: [...players.values()].map((q) => ({ id: q.id, name: q.name, alive: q.alive, seat: q.seat })),
    inFlight: !!flight,
    winner,
    lastBoom,
  };
}
const pushState = () => { for (const p of players.values()) send(p.ws, stateFor(p)); };

// The spectator screen sees everything, which is the joke for people watching.
const spectators = new Set();
const pushSpectate = () => {
  const msg = JSON.stringify({
    t: "spectate", phase, now: now(), holder, flight, fuseAt, winner, lastBoom,
    players: [...players.values()].map((q) => ({ id: q.id, name: q.name, alive: q.alive })),
  });
  for (const ws of spectators) ws.readyState === 1 && ws.send(msg);
};

function startRound() {
  const list = alive();
  if (list.length < 2) return;
  phase = "live";
  winner = null; lastBoom = null; flight = null;
  holder = list[Math.floor(Math.random() * list.length)].id;
  fuseAt = now() + FUSE[0] + Math.random() * (FUSE[1] - FUSE[0]);
  lockUntil = now() + CATCH_LOCK;
  pushState(); pushSpectate();
}

function pass(from, angle) {
  if (phase !== "live" || holder !== from || flight || now() < lockUntil) return;
  const others = alive().filter((p) => p.id !== from);
  if (!others.length) return;
  // Throw toward whoever sits closest to the swipe direction.
  const target = others.reduce((best, p) => {
    const d = Math.abs(Math.atan2(Math.sin(p.seat - angle), Math.cos(p.seat - angle)));
    return d < best.d ? { p, d } : best;
  }, { p: others[0], d: Infinity }).p;
  flight = { from, to: target.id, arriveAt: now() + FLIGHT };
  holder = null;
  pushState(); pushSpectate();
}

function tick() {
  if (phase !== "live") return;
  const t = now();
  if (flight && t >= flight.arriveAt) {
    holder = flight.to; flight = null; lockUntil = t + CATCH_LOCK;
    pushState(); pushSpectate();
  }
  if (t >= fuseAt) {
    // In flight when it blows? The person it was thrown to wears it. Don't throw late.
    const loserId = holder ?? flight?.to;
    const loser = players.get(loserId);
    if (loser) loser.alive = false;
    lastBoom = { id: loserId, name: loser?.name || "?", at: t };
    holder = null; flight = null;
    const left = alive();
    if (left.length <= 1) { phase = "over"; winner = left[0]?.name || null; pushState(); pushSpectate(); }
    else { phase = "gap"; pushState(); pushSpectate(); setTimeout(startRound, 2600); }
  }
}
setInterval(tick, 50);

wss.on("connection", (ws, req) => {
  if (new URL(req.url, "http://x").searchParams.has("spectate")) {
    spectators.add(ws);
    ws.on("close", () => spectators.delete(ws));
    pushSpectate();
    return;
  }
  let me = null;
  ws.on("message", (buf) => {
    let msg; try { msg = JSON.parse(buf); } catch { return; }
    if (msg.t === "join") {
      me = { id: nextId++, name: String(msg.name || "player").slice(0, 12), alive: phase === "lobby", seat: 0, ws };
      players.set(me.id, me);
      seats();
      send(ws, { t: "hello", id: me.id });
      pushState(); pushSpectate();
    } else if (msg.t === "ping") {
      send(ws, { t: "pong", c: msg.c, s: now() });          // client works out its own clock offset
    } else if (msg.t === "pass" && me) {
      pass(me.id, Number(msg.angle) || 0);
    } else if (msg.t === "start" && me && phase !== "live") {
      for (const p of players.values()) p.alive = true;
      startRound();
    }
  });
  ws.on("close", () => {
    if (!me) return;
    players.delete(me.id);
    seats();
    if (holder === me.id) { holder = null; fuseAt = Math.min(fuseAt, now() + 1200); }
    pushState(); pushSpectate();
  });
});

http.listen(PORT, () => console.log(`blindside on http://localhost:${PORT}`));
